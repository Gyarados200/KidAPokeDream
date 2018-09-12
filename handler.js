'use strict';

const request = require('request');

const redis = require('./redis.js');
const commandParser = require('./command-parser.js');

const ACTION_URL = 'http://play.pokemonshowdown.com/action.php';

let settings = redis.useDatabase('settings');

const userlists = {};

const chatHandler = global.ChatHandler = commandParser.new(userlists, settings);

module.exports = {
	toJoin: [],
	userlists: userlists,
	chatHandler: chatHandler,

	async setup(assertion) {
		this.send(null, `/avatar ${Config.avatar}`);
		this.userid = toId(Config.username);

		Array.prototype.push.apply(this.toJoin, Config.rooms);

		let autojoin = await settings.lrange('autojoin', 0, -1);

		if (autojoin && autojoin.length) {
			Array.prototype.push.apply(
				this.toJoin,
				autojoin.filter(r => !this.toJoin.includes(r))
			);
		}

		Debug.log(3, `Joining rooms: ${this.toJoin.join(', ')}`);

		this.send(null, `/autojoin ${this.toJoin.slice(0, 11).join(',')}`);
		this.send(null, `/trn ${Config.username},0,${assertion}`);

		this.extraJoin = this.toJoin.slice(11);

		Output.log('status', 'Setup done.');
	},

	addUser(user, room) {
		if (!(room in this.userlists)) {
			this.userlists[room] = {};
		}

		if (Array.isArray(user)) {
			Debug.log(3, `Adding array of users to userlist of ${room}: ${user}`);
			this.userlists[room] = {};
			for (let i = 0; i < user.length; i++) {
				this.userlists[room][toId(user[i])] = [user[i][0], toId(user[i])];
			}
			return true;
		}
		this.userlists[room][toId(user)] = [user[0], toId(user)];

		this.chatHandler.parseJoin(user, room);
	},

	removeUser(user, room) {
		if (!(room in this.userlists)) return false;
		delete this.userlists[room][toId(user)];
	},

	async tryJoin(roomid, remove) {
		if (!this.extraJoin) return;
		if (roomid) {
			let idx = this.extraJoin.indexOf(roomid);
			if (idx < 0) return;
			this.extraJoin.splice(idx, 1);
			if (remove) settings.lrem('privaterooms', 0, roomid);
		}
		if (!this.extraJoin.length) return;

		setTimeout(() => this.send(null, `/join ${this.extraJoin[0]}`), 500);
	},

	async parse(message) {
		if (!message) return;
		let split = message.split('|');
		let first = split[0].split('\n');
		let roomid = toId(first[0]) || 'lobby';
		if (split[0].startsWith('(') || (first.length > 1 && first[1].startsWith('('))) {
			if (split[0].startsWith('(')) roomid = 'lobby';
			this.chatHandler.parseModnote(roomid, first[first.length - 1].slice(1, -1));
		}
		switch (split[1]) {
		case 'challstr':
			Output.log('status', 'Received challstr, logging in...');

			let challstr = split.slice(2).join('|');

			request.post(ACTION_URL, {
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: 'act=login&name=' + Config.username + '&pass=' + Config.password + '&challstr=' + challstr,
			}, (error, response, body) => {
				if (!error && response.statusCode === 200) {
					if (body[0] === ']') {
						try {
							body = JSON.parse(body.substr(1));
						} catch (e) {}
						if (body.assertion && body.assertion[0] !== ';') {
							this.setup(body.assertion);
						} else {
							Output.log('client', "Can't log in.");
							process.exit(0);
						}
					} else {
						Output.log('client', "Invalid login request.");
						process.exit(0);
					}
				}
			});
			break;
		case 'updateuser':
			if (split[2] !== Config.username) return false;

			Output.log('status', 'Logged in as ' + split[2] + '.');

			if (this.toJoin.length > 11) {
				Output.log('status', 'Joining additional rooms...');

				this.tryJoin();
			}

			// Set up REPL when bot is ready to receive messages.
			this.chatHandler.setupREPL();

			break;
		case 'J':
		case 'j':
			this.addUser(split[2], roomid);
			break;
		case 'L':
		case 'l':
			this.removeUser(split[2], roomid);
			break;
		case 'N':
		case 'n':
			this.removeUser(split[3], roomid);
			this.addUser(split[2], roomid);
			break;
		case 'noinit':
		case 'deinit':
			this.tryJoin(roomid, true);
			break;
		case 'init':
			this.tryJoin(roomid);
			this.addUser(split[6].trim().split(',').slice(1), roomid);
			break;
		case 'pm':
			if (toId(split[2]) === this.userid) return false;

			this.chatHandler.parse(split[2], null, split.splice(4).join('|').trim());
			break;
		case 'c':
			if (toId(split[2]) === this.userid) return;

			this.chatHandler.parse(split[2], roomid, split.splice(3).join('|').trim());
			break;
		case 'c:':
			if (toId(split[3]) === this.userid) return;
			let msg = split.splice(4).join('|').trim().split('\n')[0];
			ChatLogger.log(split[2], roomid, toId(split[3]), msg);
			this.chatHandler.parse(split[3], roomid, msg);
			break;
		case 'tournament':
			let cmds = ('|' + split.slice(1).join('|')).split('\n'); // This is very gross voodoo and there must be a better way to tackle this but I was lazy when writing this.
			for (const cmd of cmds) {
				if (!cmd) continue;
				const cmdsplit = cmd.split('|');
				this.chatHandler.parseTourCommand(roomid, cmdsplit[2], cmdsplit.slice(3));
			}
		default:
			Debug.log(5, `Unsupported message type: ${split[1]}`);
		}
	},

	sendPM(user, message) {
		Connection.send(`|/w ${user}, ${message}`);
	},

	send(room, message) {
		Connection.send(`${room || ''}|${message}`);
	},
};
