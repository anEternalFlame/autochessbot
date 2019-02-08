winston = require("winston");

const Discord = require('discord.js'),
    discordClient = new Discord.Client();

const randtoken = require("rand-token");
const fs = require("fs");

global.config = require("./config");

const logger = winston.createLogger({
    level: 'error',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: config.logfile_error, level: 'error' }),
        new winston.transports.File({ filename: config.logfile })
    ]
});

const request = require('request');

const Sequelize = require('sequelize');
const Op = Sequelize.Op;
const sequelize = new Sequelize('autochess', 'postgres', 'postgres', {
    host: 'localhost',
    dialect: 'sqlite',

    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    },

    logging: logger.info,

    // http://docs.sequelizejs.com/manual/tutorial/querying.html#operators
    operatorsAliases: false,

    // SQLite only
    storage: global.config.sqlitedb
});

const User = sequelize.define('user', {
    discord: {
        type: Sequelize.TEXT,
        unique: true,
        allowNull: false,
    },
    steam: {
        type: Sequelize.TEXT,
        // unique: true, // might be bad idea to enforce this (others might steal steam_id without verification)
        allowNull: true,
    },
    rank: {
        type: Sequelize.TEXT,
        allowNull: true,
    },
    // unused, future proofing database
    score: {
        type: Sequelize.TEXT,
        allowNull: true,
    },
    games_played: {
        type: Sequelize.INTEGER,
        allowNull: true,
    },
    steamLinkToken: {
        type: Sequelize.TEXT,
        allowNull: true,
    },
    validated: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
    }
});

User.sync();


PREFIX = "!cb ";

discordClient.on('ready', () => {
    logger.info(`Logged in as ${discordClient.user.tag}!`);
    try {
        discordClient.channels.get("542754359860264981").send("I am back!");
    } catch(err) {
        logger.error(err);
    }
});

function parseCommand(message) {
    if (message.content.substring(0, PREFIX.length) === PREFIX) {
        const args = message.content.slice(PREFIX.length).trim().split(/ +/g);
        const command = args.shift().toLowerCase();

        return {command: command, args: args};
    }
    if (message.content.substring(0, 1) === "!") {
        const args = message.content.slice(1).trim().split(/ +/g);
        const command = args.shift().toLowerCase();

        return {command: command, args: args};
    }
}

function reply(message, text, priv=false, mention=true) {
    if (priv === true) {
        message.author.send(text);
        logger.info('Sent private message to ' + message.author.username + ': ' + text);
    } else {
        if (mention) {
            message.channel.send('<@' + message.author.id + '> ' + text);
            logger.info('Sent message in channel ' + message.channel.name + ' to ' + message.author.username + ': ' + text);
        } else {
            message.channel.send(text);
            logger.info('Sent message in channel ' + message.channel.name + ': ' + text);
        }
    }
}

function getRankString(rank) {
    if (rank > 0 && rank <= 9) { return "Pawn-" + (rank).toString();}
    if (rank >= 10 && rank < (10 + 9)) { return "Knight-" + (rank - 9).toString(); }
    if (rank >= (10 + 9) && rank < (10 + 9 + 9)) { return "Bishop-" + (rank - 9 - 9).toString(); }
    if (rank >= (10 + 9 + 9) && rank < (10 + 9 + 9 + 9)) { return "Rook-" + (rank - 9 - 9 - 9).toString(); }
    if (rank >= (10 + 9 + 9 + 9) && rank < (10 + 9 + 9 + 9 + 1)) { return "King"; }
    if (rank >= (10 + 9 + 9 + 9 + 1)) { return "Queen"; }
    // if (rank >= (10 + 9 + 9 + 9) && rank < (10 + 9 + 9 + 9 + 1)) { return "King-" + (rank - 9 - 9 - 9 - 9).toString(); }
    // if (rank >= (10 + 9 + 9 + 9 + 1)) { return "Queen-" + (rank - 9 - 9 - 9 - 9 - 1).toString(); }
    return "ERROR";
}

function parseRank(rankInput) {
    let stripped = rankInput.toLowerCase().replace(/\W+/g, '');
    let rankStr = stripped.replace(/[0-9]/g, '');
    let rankNum = stripped.replace(/[a-z]/g, '');

    let mappings = {"pawn": 0, "knight": 1, "bishop": 2, "rook": 3, "king": 4, "queen": 5};

    if (rankStr === "king") return 37;
    if (rankStr === "queen") return 38;

    if (rankNum < 1 || rankNum > 9) {
        return null;
    }
    if (!mappings.hasOwnProperty(rankStr)) {
        return null;
    }

    let rank = 0;

    rank = rank + mappings[rankStr] * 9;
    rank = rank + parseInt(rankNum);

    return rank;
}

function getRankFromSteamId(steamId) {
    return new Promise(function(resolve, reject) {
        request('http://101.200.189.65:431/dac/ranking/get?player_ids=' + steamId, { json: true}, (err, res, body) => {
            if (err) { reject(err); }

            if (res !== undefined && res.hasOwnProperty("statusCode")) {
                if (res.statusCode === 200) {
                    try {
                        // logger.info("Got result from server: " + JSON.stringify(body.user_info));
                        if (body.ranking_info.length === 1) {
                            resolve({
                                "mmr_level": body.ranking_info[0]["mmr_level"],
                                "score": body.ranking_info[0]["score"],
                            })
                        } else {
                            resolve(null);
                        }
                    } catch (error) {
                        logger.error(error);
                    }
                }
            }
        });
    });
}

function getRanksFromSteamIdList(steamIdList) {
    return new Promise(function(resolve, reject) {
        request('http://101.200.189.65:431/dac/ranking/get?player_ids=' + steamIdList.join(','), { json: true}, (err, res, body) => {
            if (err) { reject(err); }

            if (res !== undefined && res.hasOwnProperty("statusCode")) {
                if (res.statusCode === 200) {
                    try {
                        // logger.info("Got result from server: " + JSON.stringify(body.ranking_info));
                        resolve(body.ranking_info);
                    } catch (error) {
                        logger.error(error);
                    }
                }
            }
        });
    });
}

function parseDiscordId(discordStr) {
    if (discordStr.substring(1, 2) === "@") {
        let result = discordStr.substring(2, discordStr.length - 1);

        if (result[0] === "!") {
            result = result.substring(1);
        }

        return result;
    } else {
        return null;
    }
}

let botDownMessage = "Bot is restarting. Lobby commands are currently disabled. Be back soon!";

let adminRoleName = global.config.adminRoleName;
let leagueRoles = global.config.leagueRoles;
let leagueToLobbiesPrefix = global.config.leagueToLobbiesPrefix;
let lobbiesToLeague = global.config.lobbiesToLeague;
let leagueRequirements = global.config.leagueRequirements;
let leagueChannels = global.config.leagueChannels;
let validRegions = global.config.validRegions;
let regionTags = global.config.regionTags;
let exemptLeagueRolePruning = global.config.exemptLeagueRolePruning;
let lobbies = {}; // we keep lobbies in memory
let listratelimit = {};
let disableLobbyCommands = false;
let init = false;
let disableLobbyHost = false;
let lastBackup = Date.now();

leagueRoles.forEach(leagueRole => {
    lobbies[leagueToLobbiesPrefix[leagueRole]] = {};
    validRegions.forEach(leagueRegion => {
        lobbies[leagueToLobbiesPrefix[leagueRole] + "-" + leagueRegion.toLowerCase()] = {};
    });
});

let leagueLobbies = [];
let leagueChannelToRegion = {};
leagueRoles.forEach(leagueRole => {
    leagueLobbies.push(leagueToLobbiesPrefix[leagueRole]);
    lobbiesToLeague[leagueToLobbiesPrefix[leagueRole]] = leagueRole;
    leagueChannelToRegion[leagueToLobbiesPrefix[leagueRole]] = null;
    validRegions.forEach(leagueRegion => {
        leagueLobbies.push(leagueToLobbiesPrefix[leagueRole] + "-" + leagueRegion.toLowerCase());
        lobbiesToLeague[leagueToLobbiesPrefix[leagueRole] + "-" + leagueRegion.toLowerCase()] = leagueRole;
        leagueChannelToRegion[leagueToLobbiesPrefix[leagueRole] + "-" + leagueRegion.toLowerCase()] = leagueRegion;
    });
});

function getLobbyForHost(leagueChannel, host) {
    let result = null;
    for (let hostId in lobbies[leagueChannel]) {
        if (lobbies[leagueChannel].hasOwnProperty(hostId)) {
            let lobby = lobbies[leagueChannel][hostId];

            if (lobby["host"] === host) {
                result = lobby;
            }
        }
    }
    return result;
}

function getLobbyForPlayer(leagueChannel, player) {
    let result = null;
    for (let hostId in lobbies[leagueChannel]) {
        if (lobbies[leagueChannel].hasOwnProperty(hostId)) {
            let lobby = lobbies[leagueChannel][hostId];

            lobby["players"].forEach(p => {
                if (p === player) {
                    result = lobby;
                }
            });
        }
    }
    return result;
}

function getSteamPersonaNames(steamIds) {
    return new Promise(function(resolve, reject) {
        request("http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=" + config.steam_token + "&steamids=" + steamIds.join(","), { json: true}, (err, res, body) => {
            if (err) { reject(err); }

            if (res !== undefined && res.hasOwnProperty("statusCode")) {
                if (res.statusCode === 200) {
                    try {
                        // logger.info("Got result from server: " + JSON.stringify(body.response));

                        let personaNames = {};

                        steamIds.forEach(steamId => {
                            personaNames[steamId] = "ERROR";
                        });

                        for (let playerKey in body.response.players) {
                            if (body.response.players.hasOwnProperty(playerKey)) {
                                let player = body.response.players[playerKey];

                                personaNames[player["steamid"]] = player["personaname"];
                            }
                        }

                        resolve(personaNames);
                    } catch (error) {
                        logger.error(error);
                    }
                }
            }
        });
    });

}

function getSteamProfiles(steamIds) {
    return new Promise(function(resolve, reject) {
        request("http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=" + config.steam_token + "&steamids=" + steamIds.join(","), { json: true}, (err, res, body) => {
            if (err) { reject(err); }

            if (res !== undefined && res.hasOwnProperty("statusCode")) {
                if (res.statusCode === 200) {
                    try {
                        // logger.info("Got result from server: " + JSON.stringify(body.response));

                        let personaNames = {};

                        for (let playerKey in body.response.players) {
                            if (body.response.players.hasOwnProperty(playerKey)) {
                                let player = body.response.players[playerKey];

                                personaNames[player["steamid"]] = player;
                            }
                        }

                        resolve(personaNames);
                    } catch (error) {
                        logger.error(error);
                    }
                }
            }
        });
    });
}

function backUpLobbies() {
    if (Date.now() - lastBackup > 5000) {
        fs.writeFileSync(config.lobbies_file, JSON.stringify(lobbies), (err) => {
            if (err) {
                logger.error(err)
            }
        });
    }
}


discordClient.on('message', message => {
    if (init === false) {
        let lobbiesData = "";
        try {
            lobbiesData = fs.readFileSync(config.lobbies_file, 'utf8');
        } catch (e) {
            fs.writeFileSync(config.lobbies_file, "", (err) => {
                if (err) {
                    logger.error(err)
                }
            });
        }
        if (lobbiesData === "") {
            leagueRoles.forEach(leagueRole => {
                lobbies[leagueToLobbiesPrefix[leagueRole]] = {};
                validRegions.forEach(leagueRegion => {
                    lobbies[leagueToLobbiesPrefix[leagueRole] + "-" + leagueRegion.toLowerCase()] = {};
                });
            });
        } else {
            lobbies = JSON.parse(lobbiesData);
        }
        init = true;
    }

    backUpLobbies();

    if (message.author.bot === true) {
        return 0; // ignore bot messages
    }
    // private message
    if (message.channel.type === "dm") {
        // nothing
    }
    if (message.content.substring(0, PREFIX.length) === PREFIX || message.content.substring(0, 1) === "!") {
        logger.info (" *** Received command: " + message.content);

        let parsedCommand = parseCommand(message);
        let userPromise = User.findOne({where: {discord: message.author.id}});


        userPromise.then(user => {
            let isLobbyCommand = true;

            if (leagueLobbies.includes(message.channel.name)) {
                let leagueRole = lobbiesToLeague[message.channel.name];
                let leagueChannel = message.channel.name;
                let leagueChannelRegion = leagueChannelToRegion[leagueChannel];

                if (user === null || user.steam === null) {
                    reply(message, "You need to link a steam id to use bot commands in lobbies. See <#542454956825903104> for more information.");
                    return 0;
                }

                switch (parsedCommand.command) {
                    case "admincancel":
                    case "adminclose":
                    case "adminend":
                        let botAdminRoleEnd = message.guild.roles.find(r => r.name === adminRoleName);
                        if (message.member.roles.has(botAdminRoleEnd.id)) {

                            if (parsedCommand.args.length !== 1) {
                                reply(message, "Sir, the command is `!admincancel [@host]`");
                            }

                            let hostLobbyDiscordId = parseDiscordId(parsedCommand.args[0]);
                            User.find({where: {discord: hostLobbyDiscordId}}).then(hostUser => {
                                let hostLobbyEnd = getLobbyForHost(leagueChannel, hostUser.steam);
                                let regionEnd = hostLobbyEnd["region"];

                                delete lobbies[leagueChannel][hostUser.steam];
                                reply(message, "Sir, I cancelled <@" + hostUser.discord + ">'s lobby for " + regionEnd + ".");
                            });
                        } else {
                            // no permissions
                        }
                        break;
                    case "adminkick":
                        let botAdminRoleKick = message.guild.roles.find(r => r.name === adminRoleName);
                        if (!message.member.roles.has(botAdminRoleKick.id)) {
                            // no permissions
                            return 0;
                        }

                        if (parsedCommand.args.length !== 2) {
                            reply(message, "Sir, the command is `!adminkick [@host] [@player]`.");
                            return 0;
                        }
                        let hostDiscordIdKick = parseDiscordId(parsedCommand.args[0]);
                        let playerDiscordIdKick = parseDiscordId(parsedCommand.args[1]);

                        if (hostDiscordIdKick === null) {
                            reply(message, "Sir, that host id is invalid.");
                        }
                        if (playerDiscordIdKick === null) {
                            reply(message, "Sir, that player id is invalid.");
                        }

                        User.findOne({where: {discord: hostDiscordIdKick}}).then(hostUser => {
                            User.findOne({where: {discord: playerDiscordIdKick}}).then(playerUser => {
                                let hostLobby = getLobbyForHost(leagueChannel, hostUser.steam);
                                if (hostLobby === null) {
                                    reply(message, "Sir, that person is not hosting a lobby currently.");
                                    return 0;
                                }
                                if (hostUser.steam === playerUser.steam) {
                                    reply(message, "Sir, you can not kick the host from their own lobby. Use `!admincancel [@host]` instead.");
                                    return 0;
                                }

                                let index = lobbies[leagueChannel][hostUser.steam].players.indexOf(playerUser.steam);

                                if (index > -1) {
                                    lobbies[leagueChannel][hostUser.steam].players.splice(index, 1);
                                    let kickUserName = message.client.users.find("id", playerUser.discord);
                                    lobbies[leagueChannel][hostUser.steam].lastactivity = Date.now();
                                    reply(message, "kicked " + kickUserName + " from <@" + hostUser.discord + "> @" + hostLobby.region + " region lobby. `(" + lobbies[leagueChannel][hostUser.steam].players.length + "/8)`");
                                    message.guild.members.get(playerUser.discord).send("<#" + message.channel.id + "> An admin kicked you from <@" + hostUser.discord + "> @" + hostLobby.region + " region lobby.");
                                }
                            });
                        });
                        break;
                    case "host": // done
                        if (disableLobbyCommands === true) {
                            reply(message, botDownMessage);
                            return 0;
                        }
                        if (disableLobbyHost === true) {
                            reply(message, "Lobby hosting disabled. Bot is going down for maintenance.");
                        }

                        let hostLobbyExist = getLobbyForHost(leagueChannel, user.steam);

                        if (hostLobbyExist !== null) {
                            reply(message, "You are already hosting a lobby.");
                            return 0;
                        }
                        if (parsedCommand.args.length === 0) {
                            if (leagueChannelRegion !== null) {
                                parsedCommand.args[0] = leagueChannelRegion;
                            } else {
                                reply(message, "Invalid arguments. Try `!host [" + validRegions.join(', ').toLowerCase() + "] [[Rank-1]]`");
                                return 0;
                            }
                        }

                        let region = parsedCommand.args[0].toUpperCase();

                        if (leagueChannelRegion !== null && leagueChannelRegion !== region) {
                            reply(message, "You can only host " + leagueChannelRegion + " region lobbies in this channel.");
                            return 0;
                        }


                        let rankRequirement = leagueRequirements[leagueRole];

                        if (parsedCommand.args.length === 1) {
                            rankRequirement = leagueRequirements[leagueRole];
                        } else if (parsedCommand.args.length === 2) {
                            rankRequirement = parseRank(parsedCommand.args[1]);

                            if (rankRequirement === null) {
                                reply(message, "Invalid rank requirement. Example: Bishop-1");
                                return 0;
                            }
                        } else if (parsedCommand.args.length > 2) {
                            reply(message, "Invalid arguments. Must be [" + validRegions.join(', ') + "] [Rank-1]");
                            return 0;
                        }

                        if (!validRegions.includes(region)) {
                            reply(message, "Invalid arguments. Must be [" + validRegions.join(', ') + "] [Rank-1]");
                            return 0;
                        }

                        // create lobby
                        getRankFromSteamId(user.steam).then(rank => {
                            if (rank === null) {
                                reply(message, "I am having problems verifying your rank.");
                                return 0;
                            }
                            user.update({rank: rank.mmr_level, score: rank.score});
                            if (rank.mmr_level < leagueRequirements[leagueRole]) {
                                reply(message, "You are not high enough rank to host this lobby. (Your rank: `" + getRankString(rank.mmr_level) + "`, required rank: `" + getRankString(leagueRequirements[leagueRole]) + "`)");
                                return 0;
                            }
                            if (rank.mmr_level < rankRequirement) {
                                reply(message, "You are not high enough rank to host this lobby. (Your rank: `" + getRankString(rank.mmr_level) + "`, required rank: `" + getRankString(rankRequirement) + "`)");
                                return 0;
                            }
                            // good to start
                            let token = randtoken.generate(5);

                            lobbies[leagueChannel][user.steam] = {
                                "host": user.steam,
                                "password": region.toLowerCase() + "_" + token.toLowerCase(),
                                "players": [user.steam],
                                "region": region,
                                "rankRequirement": rankRequirement,
                                "starttime": Date.now(),
                                "lastactivity": Date.now(),
                            };

                            let currentLobby = getLobbyForPlayer(leagueChannel, user.steam);

                            reply(message, "**" + leagueChannels[leagueChannel] + " " + regionTags[region] + " Lobby started by <@" + user.discord + "> `" + getRankString(rank.mmr_level) + "`. \nType \"!join <@" + user.discord + ">\" to join! [`" + getRankString(lobbies[leagueChannel][user.steam]["rankRequirement"]) + "` required to join]** \nThe bot will whisper you the password on Discord. Please do not post it here.", false, false);
                            reply(message, leagueChannels[leagueChannel] + " Please host a private Dota Auto Chess lobby in " + region + " region with the following password: `" + lobbies[leagueChannel][user.steam]["password"] + "`. \nPlease remember to double check people's ranks and make sure the right ones joined the game before starting. \nYou can see the all players in the lobby by using `!lobby` in the channel. \nWait until the game has started in the Dota 2 client before typing `!start`. \nIf you need to kick a player from the Discord lobby that has not joined your Dota 2 lobby or if their rank changed, use `!kick @player` in the channel.", true);
                        });
                        break;
                    case "start": // done
                        if (disableLobbyCommands === true) {
                            reply(message, botDownMessage);
                            return 0;
                        }

                        // check 8/8 then check all ranks, then send passwords
                        let hostLobbyStart = lobbies[leagueChannel][user.steam];

                        if (hostLobbyStart === undefined || hostLobbyStart === null) {
                            reply(message, "You are not hosting any lobbies in <#" + message.channel.id + ">", true);
                            message.delete("Processed").catch(logger.error);
                            return 0;
                        }

                        let lobby = lobbies[leagueChannel][user.steam];

                        if (parsedCommand.args.length > 0) { // TODO: DRY
                            let force = parsedCommand.args[0];

                            if (force !== "force") {
                                reply(message, "Invalid arguments");
                                return 0;
                            }
                            if (lobby.players.length < 2) {
                                reply(message, "You need at least 2 players to force start a lobby. `(" + hostLobbyStart.players.length + "/8)`");
                                return 0;
                            }

                            let wheres = [];
                            lobbies[leagueChannel][user.steam].players.forEach(steamId => {
                                wheres.push({steam: steamId});
                            });
                            User.findAll({where: {[Op.or]: wheres}}).then(players => {
                                getSteamPersonaNames(lobby.players).then(personas => {
                                    let playerDiscordIds = [];
                                    let hostUserDiscordId = null;

                                    players.forEach(player => {
                                        if (player.steam !== lobby.host) {
                                            playerDiscordIds.push("<@" + player.discord + "> \"" + personas[player.steam] + "\" `" + getRankString(player.rank) + "`");
                                        } else {
                                            playerDiscordIds.push("<@" + player.discord + "> \"" + personas[player.steam] + "\" `" + getRankString(player.rank) + "` **[Host]**");
                                            hostUserDiscordId = player.discord;
                                        }
                                    });

                                    delete lobbies[leagueChannel][user.steam];

                                    reply(message, "**" + leagueChannels[leagueChannel] + " <@" + hostUserDiscordId + "> @" + hostLobbyStart.region + " region lobby started. Good luck!** " + playerDiscordIds.join(" | "));
                                });
                            });
                        } else {
                            if (lobby.players.length === 8) {
                                let wheres = [];
                                lobbies[leagueChannel][user.steam].players.forEach(steamId => {
                                    wheres.push({steam: steamId});
                                });
                                User.findAll({where: {[Op.or]: wheres}}).then(players => {
                                    getSteamPersonaNames(lobby.players).then(personas => {
                                        let playerDiscordIds = [];
                                        let hostUserDiscordId = null;

                                        players.forEach(player => {
                                            if (player.steam !== lobby.host) {
                                                playerDiscordIds.push("<@" + player.discord + "> \"" + personas[player.steam] + "\" `" + getRankString(player.rank) + "`");
                                            } else {
                                                playerDiscordIds.push("<@" + player.discord + "> \"" + personas[player.steam] + "\" `" + getRankString(player.rank) + "` **[Host]**");
                                                hostUserDiscordId = player.discord;
                                            }
                                        });

                                        reply(message, "**" + leagueChannels[leagueChannel] + " <@" + hostUserDiscordId + "> @" + lobbies[leagueChannel][user.steam]["region"] + " region lobby started. Good luck!** " + playerDiscordIds.join(" | "));
                                        delete lobbies[leagueChannel][user.steam];
                                    });
                                });
                            } else {
                                reply(message, "Not enough players to start yet. `(" + hostLobbyStart.players.length + "/8)`");
                            }
                        }
                        break;
                    case "join": // done
                        if (disableLobbyCommands === true) {
                            reply(message, botDownMessage);
                            return 0;
                        }

                        let playerLobbyJoin = getLobbyForPlayer(leagueChannel, user.steam);

                        if (playerLobbyJoin !== null) {
                            reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": You are already in a lobby! Use `!leave` to leave.", true);
                            message.delete("Processed").catch(logger.error);
                            return 0;
                        }
                        if (parsedCommand.args.length === 0) {
                            if (leagueChannelRegion === null) {
                                reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": Need to specify a host or region to join.", true);
                                message.delete("Processed").catch(logger.error);
                                return 0;
                            } else {
                                parsedCommand.args[0] = leagueChannelRegion;
                            }
                        }

                        getRankFromSteamId(user.steam).then(rank => {
                            if (rank === null) {
                                reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": I am having problems verifying your rank.", true);
                                message.delete("Processed").catch(logger.error);
                                return 0;
                            }
                            let resultLobbyHostId = null;

                            if (validRegions.includes(parsedCommand.args[0].toUpperCase())) {
                                let region = parsedCommand.args[0].toUpperCase();
                                // find host with most users not over 8 and join.

                                if (Object.keys(lobbies[leagueChannel]).length === 0) {
                                    reply(message, "There are no lobbies for that region currently. Use `!host " + region.toLowerCase() + "` to host one!");
                                    return 0;
                                }

                                let lobbiesFull = 0;

                                for (let currentHostId in lobbies[leagueChannel]) {
                                    if (lobbies[leagueChannel].hasOwnProperty(currentHostId)) {
                                        if (lobbies[leagueChannel][currentHostId].players.length < 8) {
                                            if (rank.mmr_level >= lobbies[leagueChannel][currentHostId]["rankRequirement"] && lobbies[leagueChannel][currentHostId]["region"] === region) {
                                                if (resultLobbyHostId === null) {
                                                    resultLobbyHostId = lobbies[leagueChannel][currentHostId].host;
                                                } else {
                                                    if (lobbies[leagueChannel][currentHostId].players.length > lobbies[leagueChannel][resultLobbyHostId].players.length) {
                                                        resultLobbyHostId = lobbies[leagueChannel][currentHostId].host;
                                                    }
                                                }
                                            }
                                        } else if (lobbies[leagueChannel][currentHostId].players.length === 8) {
                                            lobbiesFull++;
                                        }
                                    }
                                }

                                if (lobbiesFull === Object.keys(lobbies[leagueChannel]).length) {
                                    reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": All lobbies full. Use `!host [region]` another lobby.", true);
                                    message.delete("Processed").catch(logger.error);
                                    return 0;
                                }

                                if (resultLobbyHostId === null) {
                                    reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": Host does not exist or you can not join any lobbies (Maybe they are all full? Use `!host [region]` to host a new lobby). Make sure you have the required rank or a lobby for that region exists. Use `!join [@host]` or `!join [region]`.", true);
                                    message.delete("Processed").catch(logger.error);
                                    return 0;
                                }
                            }

                            let filter = null;

                            if (resultLobbyHostId === null) {
                                filter = {where: {discord: parseDiscordId(parsedCommand.args[0])}};
                            } else {
                                filter = {where: {steam: resultLobbyHostId}};
                            }

                            User.findOne(filter).then(function (hostUser) {
                                if (hostUser === null) {
                                    reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": Host not found in database.", true);
                                    message.delete("Processed").catch(logger.error);
                                    return 0;
                                }
                                if (!lobbies[leagueChannel].hasOwnProperty(hostUser.steam)) {
                                    reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": Host not found. Use `!list` to see lobbies or `!host [region]` to start one!", true);
                                    message.delete("Processed").catch(logger.error);
                                    return 0;
                                }
                                if (lobbies[leagueChannel][hostUser.steam].players.length === 8) {
                                    reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": That Lobby is full. Use `!host [region]` to start another one.", true);
                                    message.delete("Processed").catch(logger.error);
                                    return 0;
                                }

                                user.update({rank: rank.mmr_level, score: rank.score});
                                if (rank.mmr_level < leagueRequirements[leagueRole]) {
                                    reply(message, "<#" + message.channel.id + "> \"" + message.content + "\":You are not high enough rank to join lobbies in this league. (Your rank: `" + getRankString(rank.mmr_level) + "`, required league rank: `" + getRankString(leagueRequirements[leagueRole]) + "`)");
                                    message.delete("Processed").catch(logger.error);
                                    return 0;
                                }
                                if (rank.mmr_level < lobbies[leagueChannel][hostUser.steam]["rankRequirement"]) {
                                    reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": You are not high enough rank to join this lobby. (Your rank: `" + getRankString(rank.mmr_level) + "`, required lobby rank: `" + getRankString(lobbies[leagueChannel][hostUser.steam]["rankRequirement"]) + "`)");
                                    message.delete("Processed").catch(logger.error);
                                    return 0;
                                }

                                lobbies[leagueChannel][hostUser.steam].players.push(user.steam);
                                lobbies[leagueChannel][hostUser.steam].lastactivity = Date.now();

                                getSteamPersonaNames([user.steam]).then(personaNames => {
                                    // reply(message, "<@" + message.author.id + "> \"" + personaNames[user.steam] + "\" `" + getRankString(rank.mmr_level) + "` joined <@" + hostUser.discord + "> @" + lobbies[leagueChannel][hostUser.steam]["region"] + " region lobby. <@" + message.author.id + "> I just whispered you the lobby password, make sure you are not ignoring whispers on Discord!`(" + lobbies[leagueChannel][hostUser.steam].players.length + "/8)`", false, false);
                                    reply(message, "<@" + message.author.id + "> \"" + personaNames[user.steam] + "\" `" + getRankString(rank.mmr_level) + "` **joined** <@" + hostUser.discord + "> @" + lobbies[leagueChannel][hostUser.steam]["region"] + " region lobby. `(" + lobbies[leagueChannel][hostUser.steam].players.length + "/8)`", false, false);
                                    message.guild.members.get(hostUser.discord).send("<@" + message.author.id + "> \"" + personaNames[user.steam] + "\" `" + getRankString(rank.mmr_level) + "` **joined** your @" + lobbies[leagueChannel][hostUser.steam]["region"] + " region lobby in <#" + message.channel.id + ">. `(" + lobbies[leagueChannel][hostUser.steam].players.length + "/8)`");
                                    reply(message, leagueChannels[leagueChannel] + " Lobby password for <@" + hostUser.discord + "> " + lobbies[leagueChannel][hostUser.steam]["region"] + " region: `" + lobbies[leagueChannel][hostUser.steam]["password"] + "`. Please join this lobby in Dota 2 Custom Games. If you cannot find the lobby, whisper the host on Discord to create it <@" + hostUser.discord + ">.", true);
                                    if (lobbies[leagueChannel][hostUser.steam].players.length === 8) {
                                        reply(message, "**@" + lobbies[leagueChannel][hostUser.steam]["region"] + " Lobby is full! <@" + hostUser.discord + "> can start the game with `!start`.**", false, false);

                                        message.guild.members.get(hostUser.discord).send("**@" + lobbies[leagueChannel][hostUser.steam]["region"] + " Lobby is full! You can start the game with `!start` in <#" + message.channel.id + ">.** \n(Only start the game if you have verified everyone in the game lobby. Use `!lobby` to see players.)");
                                    }
                                    message.delete("Processed").catch(logger.error);
                                });
                            });
                        });
                        break;
                    case "leave":
                    case "quit":
                        if (disableLobbyCommands === true) {
                            reply(message, botDownMessage);
                            return 0;
                        }

                        let playerLobbyLeave = getLobbyForPlayer(leagueChannel, user.steam);

                        if (playerLobbyLeave === null) {
                            reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": You are not in any lobbies.", true);
                            message.delete("Processed").catch(logger.error);
                            return 0;
                        }
                        if (playerLobbyLeave.host === user.steam) {
                            reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": Hosts should use `!cancel` instead of `!leave`");
                            message.delete("Processed").catch(logger.error);
                            return 0;
                        }

                        let hostDiscordQuitId = playerLobbyLeave["host"];
                        User.findOne({where: {steam: hostDiscordQuitId}}).then(function (hostUser) {
                            let index = lobbies[leagueChannel][hostUser.steam].players.indexOf(user.steam);
                            if (index > -1) {
                                lobbies[leagueChannel][hostUser.steam].players.splice(index, 1);
                                getSteamPersonaNames([user.steam]).then(personaNames => {
                                    reply(message, "<@" + message.author.id + "> \"" + personaNames[user.steam] + "\" _**left**_ <@" + hostUser.discord + "> @" + playerLobbyLeave.region + " region lobby. `(" + lobbies[leagueChannel][hostUser.steam].players.length + "/8)`", false, false);
                                    message.guild.members.get(hostUser.discord).send("<@" + message.author.id + "> \"" + personaNames[user.steam] + "\" _**left**_ your @" + playerLobbyLeave.region + " region lobby in <#" + message.channel.id + ">. `(" + lobbies[leagueChannel][hostUser.steam].players.length + "/8)`");
                                    lobbies[leagueChannel][hostUser.steam].lastactivity = Date.now();
                                    message.delete("Processed").catch(logger.error);
                                });
                            }
                        });
                        break;
                    case "kick":
                        if (disableLobbyCommands === true) {
                            reply(message, botDownMessage);
                            return 0;
                        }

                        let hostLobby = getLobbyForHost(leagueChannel, user.steam);

                        if (hostLobby === null) {
                            reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": You are not hosting any lobbies in <#" + message.channel.id + ">", true);
                            message.delete("Processed").catch(logger.error);
                            return 0;
                        }
                        if (parsedCommand.args.length < 1) {
                            reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": You need to specify a player to kick: `!kick @quest`", true);
                            message.delete("Processed").catch(logger.error);
                            return 0;
                        }
                        let kickedPlayerDiscordId = parseDiscordId(parsedCommand.args[0]);

                        if (!message.guild.member(kickedPlayerDiscordId)) {
                            reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": Could not find that user on this server.", true);
                            message.delete("Processed").catch(logger.error);
                            return 0;
                        }
                        User.findOne({where: {discord: kickedPlayerDiscordId}}).then(function (kickedPlayerUser) {
                            if (kickedPlayerUser === null) {
                                reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": User not in database. Make sure to use mentions in command: `!kick @username`", true);
                                message.delete("Processed").catch(logger.error);
                                return 0;
                            }
                            if (hostLobby.players.length === 1) {
                                reply(message, "You can not kick the last player.");
                                return 0;
                            }
                            if (hostLobby.host === kickedPlayerUser.steam) {
                                reply(message, "You can not kick yourself.");
                                return 0;
                            }
                            if (!hostLobby.players.includes(kickedPlayerUser.steam)) {
                                reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": User not in lobby.", true);
                                message.delete("Processed").catch(logger.error);
                                return 0;
                            }

                            let index = lobbies[leagueChannel][hostLobby.host].players.indexOf(kickedPlayerUser.steam);

                            if (index > -1) {
                                lobbies[leagueChannel][hostLobby.host].players.splice(index, 1);
                                let kickUserName = message.client.users.find("id", kickedPlayerDiscordId);
                                lobbies[leagueChannel][user.steam].lastactivity = Date.now();
                                reply(message, "kicked " + kickUserName + " from <@" + user.discord + "> @" + hostLobby.region + " region lobby. `(" + lobbies[leagueChannel][hostLobby.host].players.length + "/8)`");
                                message.guild.members.get(kickedPlayerDiscordId).send("<@" + user.discord + "> kicked you from their lobby in <#" + message.channel.id + ">.");
                            }
                        }, function (error) {
                            reply(message, "DB Error");
                            logger.error(error);
                        });
                        break;
                    case "list":
                    case "lobbies":
                    case "games":
                        if (disableLobbyCommands === true) {
                            reply(message, botDownMessage);
                            return 0;
                        }

                        // Get player info and print out current users in lobby.
                        let numPrinted = 0;

                        if (listratelimit.hasOwnProperty(leagueChannel)) {
                            if (Date.now() - listratelimit[leagueChannel] < 15000) {
                                reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": This command is currently rate limited in <#" + message.channel.id + ">.", true);
                                message.delete("Processed").catch(logger.error);
                                // rate limited
                                return 0;
                            }
                        }

                        let printFullList = false;
                        if (parsedCommand.args.length === 1 && parsedCommand.args[0] === "full") {
                            printFullList = true;
                        }

                        listratelimit[leagueChannel] = Date.now();

                        for (let hostId in lobbies[leagueChannel]) {
                            if (lobbies[leagueChannel].hasOwnProperty(hostId)) {
                                let lobby = lobbies[leagueChannel][hostId];
                                if (lobby.host !== null && lobby.password !== null) {
                                    let wheres = [];

                                    lobby.players.forEach(steamId => {
                                        wheres.push({steam: steamId});
                                    });

                                    User.findAll({where: {[Op.or]: wheres}}).then(players => {
                                        getSteamPersonaNames(lobby.players).then(personas => {
                                            let playerDiscordIds = [];
                                            let hostDiscord = "ERROR";
                                            let hostDiscordId = null;
                                            players.forEach(player => {
                                                if (player.steam !== lobby.host) {
                                                    playerDiscordIds.push("<@" + player.discord + "> \"" + personas[player.steam] + "\" `" + getRankString(player.rank) + "`");
                                                } else {
                                                    hostDiscord = "<@" + player.discord + "> \"" + personas[player.steam] + "\" `" + getRankString(player.rank) + "` **[Host]**";
                                                    hostDiscordId = player.discord;
                                                }
                                            });

                                            let lastActivityStr = "";
                                            let dontPrint = false;
                                            if (lobby.hasOwnProperty("lastactivity")) {
                                                let lastActivity = Math.round((Date.now() - new Date(lobby.lastactivity)) / 1000 / 60);
                                                if (lastActivity > 5) {
                                                    lastActivityStr = " (" + lastActivity + "m last activity)";
                                                }
                                                if (!dontPrint && lastActivity > 15 && !exemptLeagueRolePruning.includes(leagueRole)) {
                                                    delete lobbies[leagueChannel][lobby.host];
                                                    dontPrint = true;
                                                    reply(message, "*** @" + lobby.region + " <@" + hostDiscordId + "> lobby has been removed because of no activity for more than 15 minutes.", false, false);
                                                    message.guild.members.find(hostDiscordId).send("Your lobby in <#" + message.channel.id + "> was cancelled because of no activity (join/leaves) for more than 15 minutes.");
                                                }
                                                if (!dontPrint && lastActivity > 10 && lobby.players.length === 8 && !exemptLeagueRolePruning.includes(leagueRole)) {
                                                    delete lobbies[leagueChannel][lobby.host];
                                                    dontPrint = true;
                                                    reply(message, "*** @" + lobby.region + " <@" + hostDiscordId + "> lobby has been removed because it is full and has had no activity (join/leaves) for more than 10 minutes.", false, false);
                                                    message.guild.members.find(hostDiscordId).send("Your lobby in <#" + message.channel.id + "> was cancelled because it was full and had no activity (join/leaves) for more than 10 minutes. Please use `!start` if the game was loaded in the Dota 2 Client next time.");
                                                }
                                            }
                                            let lobbyTime = Math.round((Date.now() - new Date(lobby.starttime)) / 1000 / 60);
                                            if (!dontPrint && lobbyTime > 60 && !exemptLeagueRolePruning.includes(leagueRole)) {
                                                delete lobbies[leagueChannel][lobby.host];
                                                dontPrint = true;
                                                reply(message, "*** @" + lobby.region + " <@" + hostDiscordId + "> lobby has been removed because it has not started after 60 minutes.", false, false);
                                                message.guild.members.find(hostDiscordId).send("Your lobby in <#" + message.channel.id + "> was cancelled because it was not started after 60 minutes. Please use `!start` if the game was loaded in the Dota 2 Client next time.");
                                            }

                                            let fullStr = "";
                                            if (lobby.players.length >= 8) {
                                                fullStr = "~~";
                                            }

                                            if (!dontPrint) {
                                                if (printFullList === true) {
                                                    reply(message, fullStr + "=== @" + lobby.region + " [`" + getRankString(lobby.rankRequirement) + "+`] `(" + lobby.players.length + "/8)` " + hostDiscord + " | " + playerDiscordIds.join(" | ") + ". (" + lobbyTime + "m)" + lastActivityStr + fullStr, false, false);
                                                } else {
                                                    reply(message, fullStr + "=== @" + lobby.region + " [`" + getRankString(lobby.rankRequirement) + "+`] `(" + lobby.players.length + "/8)` " + hostDiscord + " | " + "Use \"!join <@" + hostDiscordId + ">\" to join lobby. (" + lobbyTime + "m)" + lastActivityStr + fullStr, false, false);
                                                }
                                            }
                                        });
                                    });
                                }
                            }
                            numPrinted++;
                        }
                        if (numPrinted === 0) {
                            reply(message, "There are no lobbies currently being hosted. Use `!host [region]` to host one!");
                        }
                        break;
                    case "lobby":
                        if (disableLobbyCommands === true) {
                            reply(message, botDownMessage);
                            return 0;
                        }

                        (function () { // scoping variables
                            if (parsedCommand.args.length === 0) {
                                // reply(message, "You need to specify a host.");
                                // return 0;
                                parsedCommand.args[0] = '<@' + message.author.id + '>';
                            }
                            let lobbyHostDiscordId = parseDiscordId(parsedCommand.args[0]);

                            // if (!message.guild.member(lobbyHostDiscordId)) {
                            //     reply(message, "Could not find that user on this server.");
                            //     return 0;
                            // }
                            User.findOne({where: {discord: lobbyHostDiscordId}}).then(hostUser => {
                                let lobby = getLobbyForPlayer(leagueChannel, hostUser.steam);

                                // if (user.discord === hostUser.discord) {
                                //     reply(message, leagueChannels[leagueChannel] + " You are not in a lobby.", true);
                                //     message.delete("Processed").catch(logger.error);
                                //     return 0;
                                // }
                                if (lobby === null) {
                                    reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": That user/you are is not hosting any lobbies.", true);
                                    message.delete("Processed").catch(logger.error);
                                    return 0;
                                }

                                if (lobby.host !== null && lobby.password !== null) {
                                    let wheres = [];

                                    lobby.players.forEach(steamId => {
                                        wheres.push({steam: steamId});
                                    });
                                    User.findAll({where: {[Op.or]: wheres}}).then(players => {
                                        getSteamPersonaNames(lobby.players).then(personas => {
                                            let playerDiscordIds = [];
                                            let hostDiscord = "ERROR";
                                            let hostDiscordId = null;
                                            players.forEach(player => {
                                                if (player.steam !== lobby.host) {
                                                    playerDiscordIds.push("<@" + player.discord + "> \"" + personas[player.steam] + "\" `" + getRankString(player.rank) + "`");
                                                } else {
                                                    hostDiscord = "<@" + player.discord + "> \"" + personas[player.steam] + "\" `" + getRankString(player.rank) + "` **[Host]**";
                                                    hostDiscordId = player.discord;
                                                }
                                            });

                                            let lastActivityStr = "";
                                            if (lobby.hasOwnProperty("lastacitivity")) {
                                                let lastActivity = Math.round((Date.now() - new Date(lobby.lastactivity)) / 1000 / 60);
                                                if (lastActivity > 5) {
                                                    lastActivityStr = " (" + +"m last activity)";
                                                }
                                            }
                                            reply(message, "=== @" + lobby.region + " [`" + getRankString(lobby.rankRequirement) + "+`] `(" + lobby.players.length + "/8)` " + hostDiscord + " | " + playerDiscordIds.join(" | ") + ". (" + Math.round((Date.now() - new Date(lobby.starttime)) / 1000 / 60) + "m)" + lastActivityStr, false, true);
                                            // also whisper
                                            reply(message, "=== @" + lobby.region + " [`" + getRankString(lobby.rankRequirement) + "+`] `(" + lobby.players.length + "/8)` " + hostDiscord + " | " + playerDiscordIds.join(" | ") + ". (" + Math.round((Date.now() - new Date(lobby.starttime)) / 1000 / 60) + "m)" + lastActivityStr, true);
                                            message.delete("Processed").catch(logger.error);
                                        });
                                    });
                                }
                            });
                        })();
                        break;
                    case "cancel":
                    case "close":
                    case "end":
                        if (disableLobbyCommands === true) {
                            reply(message, botDownMessage);
                            return 0;
                        }

                        let hostLobbyEnd = getLobbyForHost(leagueChannel, user.steam);

                        if (hostLobbyEnd === null) {
                            reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": You are not hosting any lobbies in <#" + message.channel.id + ">", true);
                            message.delete("Processed").catch(logger.error);
                            return 0;
                        }
                        let regionEnd = hostLobbyEnd["region"];

                        if (user.steam === lobbies[leagueChannel][user.steam]["host"]) {
                            delete lobbies[leagueChannel][user.steam];
                            reply(message, "<@" + user.discord + "> " + regionEnd + " region **lobby cancelled**.");
                            return 0;
                        }
                        break;
                    case "getpassword":
                    case "password":
                    case "pass":
                    case "sendpassword":
                    case "sendpass":
                        if (disableLobbyCommands === true) {
                            reply(message, botDownMessage);
                            return 0;
                        }

                        let playerSendPassLobby = getLobbyForPlayer(leagueChannel, user.steam);

                        if (playerSendPassLobby === null) {
                            reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": You are not in any lobbies.", true);
                            message.delete("Processed").catch(logger.error);
                            return 0;
                        }


                        User.findOne({where: {steam: playerSendPassLobby.host}}).then(function (hostUser) {
                            if (hostUser === null) {
                                reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": Host not found in database.", true);
                                message.delete("Processed").catch(logger.error);
                                return 0;
                            }
                            if (!lobbies[leagueChannel].hasOwnProperty(hostUser.steam)) {
                                reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": Host not found. Use `!list` to see lobbies or `!host [region]` to start one!", true);
                                message.delete("Processed").catch(logger.error);
                                return 0;
                            }

                            reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": Lobby password for <@" + hostUser.discord + "> " + lobbies[leagueChannel][hostUser.steam]["region"] + " region: `" + lobbies[leagueChannel][hostUser.steam]["password"] + "`. Please join this lobby in Dota 2 Custom Games. If you cannot find the lobby, whisper the host on Discord to create it <@" + hostUser.discord + ">.", true);
                            message.delete("Processed").catch(logger.error);

                        });
                        break;
                    default:
                        // reply(message, "Unhandled bot message: " + message.content);
                        // console.log("Unhandled bot message for lobby: " + message.content);
                        isLobbyCommand = false;
                }
            }

            switch (parsedCommand.command) {
                case "unlink":
                    if (user !== null && user.steam !== null) {
                        user.update({steam: null, steamLinkToken: null, validated: null});
                        // steamFriends.removeFriend(user.steam);
                        // console.log("Removed steam friends " + user.steam);

                        let ranks = [];

                        leagueRoles.forEach(leagueRole => {
                            if (message.guild === null) {
                                reply(message, "Something went wrong!");
                            }
                            let roleObj = message.guild.roles.find(r => r.name === leagueRole);

                            if (roleObj !== null) {
                                ranks.push({
                                    name: leagueRole,
                                    rank: leagueRequirements[leagueRole],
                                    role: message.guild.roles.find(r => r.name === leagueRole),
                                })
                            }
                        });
                        let removed = [];

                        if (message.member === null) {
                            reply(message, "I am having a problem seeing your roles. Are you set to Invisible on Discord?");
                        }
                        ranks.forEach(r => {
                            if (message.member.roles.has(r.role.id)) {
                                message.member.removeRole(r.role).catch(logger.error);
                                removed.push(r.name);
                            }
                        });
                        if (removed.length > 0) {
                            reply(message, "I have removed the following roles from you: `" + removed.join("`, `") + "`");
                        }

                        reply(message, "You have successfully unlinked your account.");
                    } else {
                        reply(message, "You have not linked a steam id. See <#542454956825903104> for more information.");
                    }
                    break;
                case "link":
                    // this version does not do linking and assumes validated by default
                    const steamIdLink = parsedCommand.args[0];

                    if (!parseInt(steamIdLink)) {
                        reply(message, 'Invalid steam id. See <#542494966220587038> for help.');
                        return 0;
                    }

                    if (steamIdLink.length < 12 || steamIdLink.includes("[")) {
                        reply(message, "**WARNING** That looks like an invalid steam id. Make sure you are using the \"Steam64 ID\". See <#542494966220587038> for help.");
                    }

                    // const token = randtoken.generate(6);

                    User.findAll({where: {steam: steamIdLink}}).then(existingUsers => {
                        let playerDiscordIds = [];

                        // TODO: recheck ranks here
                        existingUsers.forEach(player => {
                            playerDiscordIds.push("<@" + player.discord + ">");
                        });

                        if ((user === null && existingUsers.length > 0) || (user !== null && existingUsers.length >= 1)) {
                            reply(message, "**WARNING!** Could not link that steam id. The steam id `" + steamIdLink + "` has already been linked to these accounts: " + playerDiscordIds.join(", ") + ". See <#542494966220587038> for help.");
                            return 0;
                        }

                        if (user === null) {
                            User.create({
                                discord: message.author.id,
                                steam: steamIdLink,
                                validated: true,
                            }).then(test => {
                                // logger.info(test.toJSON());
                                reply(message, "I have linked your steam id `" + steamIdLink + "`. If I do not promote you right away then you probably used the wrong steam id or you are set to Invisible on Discord.");
                                updateRoles(message, test);
                            }).catch(Sequelize.ValidationError, function (msg) {
                                logger.error("error " + msg);
                            });
                        } else {
                            user.update({steam: steamIdLink, validated: true}).then(test => {
                                reply(message, "I have linked your steam id `" + steamIdLink + "`. If I do not promote you right away then you probably used the wrong steam id or you are set to Invisible on Discord.");
                                updateRoles(message, test);
                            });
                        }
                    });

                    // }
                    break;
                case "adminrestartbot":
                case "restartbot":
                    if (message.author.id !== "204094307689431043") {
                        return 0; // no permissions
                    }
                    disableLobbyCommands = true;

                    fs.writeFileSync(config.lobbies_file, JSON.stringify(lobbies), (err) => {
                        if (err) {
                            logger.error(err)
                        }
                    });
                    let famousLastWords = [
                        "Hey fellas! How about this for a headline for tomorrow’s paper? ‘French fries.'",
                        "What the devil do you mean to sing to me, priest? You are out of tune.",
                        "Good. A woman who can fart is not dead.",
                        "I’d hate to die twice. It’s so boring.",
                        "I did not get my Spaghetti-O’s; I got spaghetti. I want the press to know this.",
                        "I’d like to thank the Academy for my lifetime achievement award that I will eventually get.",
                        "I knew it! I knew it! Born in a hotel room and, goddamn it, dying in a hotel room.",
                        "And now for a final word from our sponsor—.",
                        "Remember, Honey, don’t forget what I told you. Put in my coffin a deck of cards, a mashie niblick, and a pretty blonde.",
                        "Damn it! Don’t you dare ask God to help me!",
                        "Yeah, country music.",
                        "Bring me a bullet-proof vest.",
                        "Surprise me.",
                        "Thank god. I’m tired of being the funniest person in the room.",
                        "I’ve had 18 straight whiskeys... I think that’s the record.",
                        "They couldn’t hit an elephant at this dist—",
                        "On the contrary.",
                        "I should have never switched from scotch to martinis.",
                        "I am sorry to bother you chaps. I don’t know how you get along so fast with the traffic on the roads these days.",
                        "Now is not the time for making new enemies.",
                        "I’m looking for loopholes.",
                        "This wallpaper and I are fighting a duel to the death. Either it goes or I do.",
                        "Gun’s not loaded… see?",
                        "Am I dying, or is this my birthday?",
                        "Oh, you young people act like old men. You have no fun.",
                        "Codeine... bourbon...",
                        "No.",
                        "I’m bored with it all.",
                        "This is no way to live.",
                        "I desire to go to Hell and not to Heaven. In the former I shall enjoy the company of popes, kings and princes, while in the latter are only beggars, monks and apostles.",
                        "Turn me over — I’m done on this side.",
                        "Now why did I do that?",
                        "Don’t let it end like this. Tell them I said something important.",
                        // "Oh Lord, forgive the misprints!",
                        // "All right, then, I’ll say it: Dante makes me sick.",
                        "I'll be back!",
                    ];
                    reply(message, famousLastWords[Math.floor(Math.random()*famousLastWords.length)]);
                    setTimeout(function () {
                        process.exit(1);
                    }, 1000);
                    break;
                case "admindisablebot":
                case "disablebot":
                    if (message.author.id !== "204094307689431043") {
                        return 0; // no permissions
                    }
                    if (disableLobbyCommands === false) {
                        disableLobbyCommands = true;

                        fs.writeFileSync(config.lobbies_file, JSON.stringify(lobbies), (err) => {
                            if (err) {
                                logger.error(err)
                            }
                        });
                        reply(message, "Sir, lobby commands disabled. Lobby data saved.");
                        // reply(message, "```\n" + JSON.stringify(lobbies) + "\n```");
                        return 0;
                    } else {
                        reply(message, "Sir, I am not enabled!");
                    }
                    break;
                case "adminenablebot":
                case "enablebot":
                    if (message.author.id !== "204094307689431043") {
                        return 0; // no permissions
                    }
                    if (disableLobbyCommands === true) {
                        disableLobbyCommands = false;

                        let lobbiesData = fs.readFileSync(config.lobbies_file, 'utf8');
                        lobbies = JSON.parse(lobbiesData);
                        reply(message, "Sir, Lobby data loaded. Lobby commands enabled.");
                        // reply(message, "```\n" + lobbiesData + "\n```");
                        return 0;
                    } else {
                        reply(message, "Sir, I am not disabled.");
                    }
                    break;
                case "admintogglehost":
                case "togglehost":
                    if (message.author.id !== "204094307689431043") {
                        return 0; // no permissions
                    }
                    if (disableLobbyHost === true) {
                        disableLobbyHost = false;
                        reply(message, "Sir, lobby hosting enabled.");
                    } else {
                        disableLobbyHost = true;
                        reply(message, "Sir, lobby hosting disabled.");
                    }
                    break;
                case "adminsavelobbies":
                case "savelobbies":
                    if (message.author.id !== "204094307689431043") {
                        return 0; // no permissions
                    }
                    fs.writeFileSync(config.lobbies_file, JSON.stringify(lobbies), (err) => {
                        if (err) {
                            logger.error(err)
                        }
                    });
                    reply(message, "Sir, lobby data saved.");
                    break;
                case "adminlobbyinfo":
                case "lobbyinfo":
                    if (message.author.id !== "204094307689431043") {
                        return 0; // no permissions
                    }
                    reply(message, "disableLobbyCommands: " + disableLobbyCommands + ", " + "disableLobbyHost: " + disableLobbyHost);
                    // add lobby sizes
                    break;
                case "adminclearlobbies":
                case "clearlobbies":
                    if (message.author.id !== "204094307689431043") {
                        return 0; // no permissions
                    }

                    if (parsedCommand.args.length !== 1) {
                        reply(message, "Sir, invalid argument, try: `!adminclearlobbies " + leagueRoles.join(", ") + "`.");
                        return 0;
                    }
                    let role = parsedCommand.args[0];

                    if (!leagueRoles.includes(role)) {
                        reply(message, "Sir, invalid League, try:" + leagueRoles.join(", "));
                    }

                    lobbies[role] = {};
                    reply(message, "Sir, I cleared " + role + " lobbies.");

                    fs.writeFileSync(config.lobbies_file, JSON.stringify(lobbies), (err) => {
                        if (err) {
                            logger.error(err)
                        }
                    });
                    break;
                case "adminclearalllobbies":
                case "clearalllobbies":
                    if (message.author.id !== "204094307689431043") {
                        return 0; // no permissions
                    }

                    lobbies = {};

                    leagueChannels.forEach(leagueChannel => {
                        lobbies[leagueChannel] = {};
                    });
                    fs.writeFileSync(config.lobbies_file, JSON.stringify(lobbies), (err) => {
                        if (err) {
                            logger.error(err)
                        }
                    });

                    reply(message, "Sir, I cleared all lobbies.");
                    break;
                case "addlobby":
                    if (message.author.id !== "204094307689431043") {
                        return 0; // no permissions
                    }

                    lobbies[parsedCommand.args[0]] = {};
                    reply(message, "OK.");
                    break;
                case "removelobby":
                    if (message.author.id !== "204094307689431043") {
                        return 0; // no permissions
                    }

                    delete lobbies[parsedCommand.args[0]];
                    reply(message, "OK.");
                    break;
                case "adminupdatelink":
                case "adminlink":
                    let botAdminRoleLink = message.guild.roles.find(r => r.name === adminRoleName);
                    if (!message.member.roles.has(botAdminRoleLink.id)) {
                        return 0; // no permissions
                    }
                    if (parsedCommand.args.length < 1) {
                        reply(message, "Sir, the command is `!adminupdatelink [@discord] [[steamid]]`");
                        return 0;
                    }
                    let linkPlayerDiscordId = parseDiscordId(parsedCommand.args[0]);

                    User.findOne({where: {discord: linkPlayerDiscordId}}).then(function (linkPlayerUser) {
                        if (linkPlayerUser === null) {
                            reply(message, "Sir, I could not find that user in the database. This command is for updating links, the user must link themselves first.");
                            return 0;
                        }
                        let steamId = null;
                        if (parsedCommand.args.length > 1) {
                            steamId = parsedCommand.args[1];
                        } else {
                            steamId = linkPlayerUser.steam;
                        }
                        linkPlayerUser.update({steam: steamId, steamLinkToken: null}).then(function (result) {
                            reply(message, "Sir, I have linked steam id " + steamId + " to <@" + linkPlayerUser.discord + ">.");
                            return 0;
                        }, function (error) {
                            logger.error(error);
                        });
                    });
                    break;
                case "adminupdateroles":
                    let botAdminUpdateRole = message.guild.roles.find(r => r.name === adminRoleName);
                    if (!message.member.roles.has(botAdminUpdateRole.id)) {
                        return 0; // no permissions
                    }
                    if (parsedCommand.args.length < 1) {
                        reply(message, "Sir, the command is `!adminlink [@discord] [[steamid]]`");
                        return 0;
                    }
                    let updateRolePlayerDiscordId = parseDiscordId(parsedCommand.args[0]);

                    User.findOne({where: {discord: updateRolePlayerDiscordId}}).then(function (playerUser) {
                        if (playerUser === null) {
                            reply(message, "Sir, I could not find that user.");
                            return 0;
                        }
                        updateRoles(message, playerUser, true, true);
                        reply(message, "Sir, trying to update roles for <@" + playerUser.discord + ">.");
                    });

                    break;
                case "admincreatelink":
                    let botAdminRoleCreateLink = message.guild.roles.find(r => r.name === adminRoleName);
                    if (!message.member.roles.has(botAdminRoleCreateLink.id)) {
                        return 0; // no permissions
                    }
                    if (parsedCommand.args.length < 1) {
                        reply(message, "Sir, the command is `!adminlink [@discord] [[steamid]]`");
                        return 0;
                    }
                    let createLinkPlayerDiscordId = parseDiscordId(parsedCommand.args[0]);
                    let forceSteamIdLink = parsedCommand.args[1];

                    User.findOne({where: {discord: createLinkPlayerDiscordId}}).then(function (linkPlayerUser) {
                        if (linkPlayerUser === null) {
                            User.create({
                                discord: createLinkPlayerDiscordId,
                                steam: forceSteamIdLink,
                                validated: true,
                            }).then(test => {
                                // logger.info(test.toJSON());
                                reply(message, "Sir, I have linked <@" + createLinkPlayerDiscordId + "> steam id `" + forceSteamIdLink + "`. Remember they will not have any roles. Use `!adminupdateroles [@discord]`.");
                            }).catch(Sequelize.ValidationError, function (msg) {
                                logger.error("error " + msg);
                            });
                        } else {
                            reply(message, "Sir, <@" + createLinkPlayerDiscordId + ") is already linked to steam id `" + linkPlayerUser.steam + "`. Use `!adminupdatelink [@discord] [steam]` instead.");
                            return 0;
                        }
                    });
                    break;
                case "adminunlink":
                    let botAdminRoleUnlink = message.guild.roles.find(r => r.name === adminRoleName);
                    if (!message.member.roles.has(botAdminRoleUnlink.id)) {
                        return 0; // no permissions
                    }
                    if (parsedCommand.args.length !== 1) {
                        reply(message, "Sir, the command is `!adminunlink [@discord]`");
                        return 0;
                    }
                    let unlinkPlayerDiscordId = parseDiscordId(parsedCommand.args[0]);

                    User.findOne({where: {discord: unlinkPlayerDiscordId}}).then(function (unlinkPlayerUser) {
                        unlinkPlayerUser.update({steam: null, validated: false}).then(function (result) {
                            reply(message, "Sir, I have unlinked <@" + unlinkPlayerUser.discord + ">'s steam id.");
                        }, function (error) {
                            logger.error(error);
                        });
                    });
                    break;
                case "adminunlinksteam":
                    let botAdminRoleUnlinkSteam = message.guild.roles.find(r => r.name === adminRoleName);
                    if (!message.member.roles.has(botAdminRoleUnlinkSteam.id)) {
                        return 0; // no permissions
                    }
                    if (parsedCommand.args.length !== 1) {
                        reply(message, "Sir, the command is `!adminunlink [steamid]`");
                        return 0;
                    }
                    if (!parseInt(parsedCommand.args[0])) {
                        reply(message, 'Sir, that is an invalid steam id');
                        return 0;
                    }
                    let unlinkPlayerSteamId = parsedCommand.args[0];

                    User.findAll({where: {steam: unlinkPlayerSteamId}}).then(function (unlinkPlayerUsers) {
                        unlinkPlayerUsers.forEach(unlinkPlayerUser => {
                            reply(message, "Sir, I have unlinked <@" + unlinkPlayerUser.discord + ">'s steam id.");
                            unlinkPlayerUser.update({steam: null, validated: false});
                        });
                    });
                    break;
                case "admingetsteam":
                case "getsteam":
                case "gets":
                    let botAdminGetSteam = message.guild.roles.find(r => r.name === adminRoleName);
                    if (!message.member.roles.has(botAdminGetSteam.id)) {
                        return 0; // no permissions
                    }
                    if (parsedCommand.args.length !== 1) {
                        reply(message, "Sir, the command is `!admingetsteam [@discord]`");
                        return 0;
                    }
                    let infoPlayerDiscordId = parseDiscordId(parsedCommand.args[0]);

                    User.findOne({where: {discord: infoPlayerDiscordId}}).then(function (infoPlayerUser) {
                        if (infoPlayerUser === null) {
                            reply(message, "Sir, I did not find any matches in database for <@" + infoPlayerUser.discord + ">");
                            return 0;
                        }
                        if (infoPlayerUser.steam === null) {
                            reply(message, "Sir, I could not find a steam id for <@" + infoPlayerUser.discord + ">. This user has tried to link a steam id and has probably unlinked it.");
                            return 0;
                        }
                        reply(message, "Sir, <@" + infoPlayerUser.discord + "> is linked to steam id: `" + infoPlayerUser.steam + "`.");
                    });
                    break;
                case "admingetdiscord":
                case "getdiscord":
                case "getd":
                    let botAdminGetDiscord = message.guild.roles.find(r => r.name === adminRoleName);
                    if (!message.member.roles.has(botAdminGetDiscord.id)) {
                        return 0; // no permissions
                    }
                    if (parsedCommand.args.length !== 1) {
                        reply(message, "Sir, the command is `!admingetdiscord [steam]`");
                        return 0;
                    }
                    const steamId = parsedCommand.args[0];

                    if (!parseInt(steamId)) {
                        reply(message, 'Sir, invalid steam id');
                        return 0;
                    }

                    User.findAll({where: {steam: steamId}}).then(players => {
                        let playerDiscordIds = [];

                        // TODO: recheck ranks here
                        players.forEach(player => {
                            playerDiscordIds.push("<@" + player.discord + "> `<@" + player.discord + ">`");
                        });

                        if (playerDiscordIds.length >= 1) {
                            reply(message, "Sir, I found these users for `" + steamId + "`: " + playerDiscordIds.join(", ") + ".");
                        } else {
                            reply(message, "Sir, I did not find any matches in database for `" + steamId + "`.");
                        }
                    });
                    break;
                case "getrank":
                case "checkrank":
                case "rank":
                    if (parsedCommand.args.length === 1) {
                        let getRankUserDiscordId = parseDiscordId(parsedCommand.args[0]);

                        if (getRankUserDiscordId !== null) {
                            if (!message.guild.member(getRankUserDiscordId)) {
                                reply(message, "Could not find that user on this server.");
                                return 0;
                            }
                            User.findOne({where: {discord: getRankUserDiscordId}}).then(getRankUser => {
                                if (getRankUser === null) {
                                    reply(message, "That user has not linked a steam id yet.");
                                    return 0;
                                }
                                getRankFromSteamId(getRankUser.steam).then(rank => {
                                    if (rank === null) {
                                        reply(message, "I am having problems verifying your rank.");
                                        return 0;
                                    }
                                    reply(message, "Current rank for <@" + getRankUser.discord + "> is: `" + getRankString(rank.mmr_level) + "`. Current MMR is: `" + rank.score + "`.");

                                    if (leagueLobbies.includes(message.channel.name)) {
                                        message.delete("Processed").catch(logger.error);
                                    }
                                    return 0;
                                });
                            });
                        } else if (parseInt(parsedCommand.args[0])) {
                            let publicSteamId = parsedCommand.args[0];

                            getRankFromSteamId(publicSteamId).then(rank => {
                                if (rank === null) {
                                    reply(message, "I am having problems verifying your rank.");
                                    return 0;
                                }
                                reply(message, "Current rank for " + publicSteamId + " is: `" + getRankString(rank.mmr_level) + "`. Current MMR is: `" + rank.score + "`.");

                                if (leagueLobbies.includes(message.channel.name)) {
                                    message.delete("Processed").catch(logger.error);
                                }
                                return 0;
                            });
                        } else {
                            reply(message, "Invalid arguments.");
                        }
                    } else {
                        if (user !== null && user.steam !== null && user.steamLinkToken === null) {
                            getRankFromSteamId(user.steam).then(rank => {
                                if (rank === null) {
                                    reply(message, "I am having problems verifying your rank.");
                                    return 0;
                                }
                                reply(message, "Your current rank is: `" + getRankString(rank.mmr_level) + "`. Your MMR is: `" + rank.score + "`.");
                                user.update({rank: rank.mmr_level, score: rank.score}).then(nothing => {
                                    if (leagueLobbies.includes(message.channel.name)) {
                                        updateRoles(message, nothing, false, false, true);
                                    } else {
                                        updateRoles(message, nothing, false, false, false);
                                    }
                                });
                            });
                        } else {
                            reply(message, "You have not linked a steam id. See <#542454956825903104> for more information.");
                        }
                    }
                    break;
                case "removerole":
                    // TODO;
                    break;
                case "getsteampersona":
                case "steampersona":
                case "getp":
                    if (parsedCommand.args.length === 1) {
                        let getSteamPersonaUserDiscordId = parseDiscordId(parsedCommand.args[0]);

                        if (getSteamPersonaUserDiscordId !== null) {
                            if (!message.guild.member(getSteamPersonaUserDiscordId)) {
                                reply(message, "Could not find that user on this server.");
                                return 0;
                            }
                            User.findOne({where: {discord: getSteamPersonaUserDiscordId}}).then(getSteamPersonaUser => {
                                getSteamPersonaNames([getSteamPersonaUser.steam]).then(personas => {
                                    reply(message, "<@" + getSteamPersonaUser.discord + "> Steam Name is \"" + personas[getSteamPersonaUser.steam] + "\"");
                                });
                            });
                        } else {
                            reply(message, "Invalid arguments.");
                        }
                    }
                    break;
                case "updateroles":
                case "updaterole":
                case "updateranks":
                case "udpaterank":
                case "roles":
                case "role":
                    if (leagueLobbies.includes(message.channel.name)) {
                        updateRoles(message, user, true, true, true);
                    } else {
                        updateRoles(message, user, true, true, false);
                    }
                    break;
                case "help":
                    reply(message, "See <#542454956825903104> for more information.");
                    break;
                default:
                    if (isLobbyCommand === false) {
                        logger.info("Unhandled bot message: " + message.content);
                        reply(message, "<#" + message.channel.id + "> \"" + message.content + "\": I was not able to process this command.\n Please read <#542454956825903104> for command list. Join <#542494966220587038> for help from staff.", true);
                        message.delete("Processed").catch(logger.error);
                        return 0;
                    }
            }
        });
    } else {
        // console.debug("Non-bot message: " + message.content);
    }
});

discordClient.on('error', logger.error);


function updateRoles(message, user, notifyOnChange=true, notifyNoChange=false, deleteMessage=false) {
    if (user !== null && user.steam !== null) {
        getRankFromSteamId(user.steam).then(rank => {
            if(rank === null) {
                reply(message, "I am having problems verifying your rank.");
                return 0;
            }
            let ranks = [];

            leagueRoles.forEach(leagueRole => {
                if (message.guild === null) {
                    reply(message, "Something went wrong!");
                    return 0;
                }
                let roleObj = message.guild.roles.find(r => r.name === leagueRole);

                if (roleObj !== null) {
                    ranks.push({
                        name: leagueRole,
                        rank: leagueRequirements[leagueRole],
                        role: message.guild.roles.find(r => r.name === leagueRole),
                    })
                }
            });

            let added = [];
            let removed = [];

            let discordUser = message.guild.members.get(user.discord);

            if (discordUser === null) {
                reply(message, "I am having a problem seeing your roles. Are you set to Invisible on Discord?");
            } else {
                ranks.forEach(r => {
                    if (discordUser.roles.has(r.role.id)) {
                        if (rank.mmr_level < r.rank) {
                            discordUser.removeRole(r.role).catch(logger.error);
                            removed.push(r.name);
                        }
                    } else {
                        if (rank.mmr_level >= r.rank) {
                            discordUser.addRole(r.role).catch(logger.error);
                            added.push(r.name);
                        }
                    }
                });

                let rankStr = getRankString(rank.mmr_level);
                if (rankStr === "ERROR") {
                    reply(message, "I had a problem getting your rank, did you use the right steam id? See <#542454956825903104> for more information. Use `!unlink` to start over.", priv, mention);
                    return 0;
                }

                let messagePrefix = "Your";
                let messagePrefix2 = "You have been";
                if (message.author.id !== user.discord) {
                    messagePrefix = "<@" + user.discord + ">";
                    messagePrefix2 = "<@" + user.discord + ">";
                }

                // always show and whisper about demotions in case they can't see the channel anymore
                if (removed.length > 0) {
                    reply(message, messagePrefix + " rank is `" + rankStr + "`. MMR is: `" + rank.score + "`. " + messagePrefix2 + " demoted from: `" + removed.join("`, `") + "` (sorry!)");
                    reply(message, messagePrefix + " rank is `" + rankStr + "`. MMR is: `" + rank.score + "`. " + messagePrefix2 + " demoted from: `" + removed.join("`, `") + "` (sorry!)", true);
                }

                if (notifyOnChange) {
                    if (added.length > 0) {
                        reply(message, messagePrefix + " rank is `" + rankStr + "`. MMR is: `" + rank.score + "`. " + messagePrefix2 + " promoted to: `" + added.join("`, `") + "`");
                    }
                }
                if (notifyNoChange) {
                    if (added.length === 0 && removed.length === 0) {
                        reply(message, messagePrefix + " rank is `" + rankStr + "`. MMR is: `" + rank.score + "`. No role changes based this your rank.");

                    }
                }
            }

            if (deleteMessage) {
                message.delete("Processed").catch(logger.error);
            }
            return 0;
        });
    }
}

discordClient.login(config.discord_token);
