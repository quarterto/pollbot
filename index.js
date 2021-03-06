const {send} = require('micro');
const route = require('boulevard');
const parseSlackBody = require('@quarterto/slack-body');
const url = require('url');
const fetch = require('node-fetch');
const pack = require('./package.json');

const config = {
	clientId: pack.config['client-id'],
	clientSecret: process.env.CLIENT_SECRET,
};

const randomId = () => Math.floor(parseInt('zzzzzzzz', 36) * Math.random()).toString(36);
const polls = new Map();
const countBadges = ' ❶❷❸❹❺❻❼❽❾❿'.split('');

const renderPoll = poll => ({
	response_type: 'in_channel',
	attachments: [{
		text: poll.question,
		callback_id: poll.id,
		attachment_type: 'default',
		actions: poll.options.map((option, i) => Object.assign({}, option, {
			text: `${option.label} ${countBadges[option.voters.size] || `❨${option.voters.size}❩`}`,
			type: 'button',
			label: undefined,
			voters: undefined,
		})),
	}],
});

const votePoll = (poll, user) => action => {
	poll.options.forEach((pollAction, i) => {
		if(action.name === pollAction.name && action.value == pollAction.value) {
			poll.options.forEach((otherAction, j) => i !== j && otherAction.voters.delete(user.id));

			if(pollAction.voters.has(user.id)) {
				pollAction.voters.delete(user.id);
			} else {
				pollAction.voters.add(user.id);
			}
		}
	})
};

const redirect = (res, location, status = 302) => {
	res.setHeader('location', location); // location
	return send(res, status);
};

module.exports = route({
	'/'(req, res) {
		const {host} = req.headers;
		const {query} = url.parse(req.url, true);

		res.setHeader('content-type', 'text/html');

		return `<!doctype html>
		<meta charset="utf-8">
		<style>
		body {
			display: flex;
			flex-direction: column;
			justify-content: center;
			align-items: center;
			height: 100vh;
			margin: 0;
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
		}
		.success {
			color: #458b00;
		}
		.error {
			color: #b1493f;
		}
		</style>

		<title>📊 Pollbot</title>

		<h1>📊 Pollbot</h1>

		${query.state === 'error' ? '<p class="error">Couldn\'t authorize with Slack. Please try again.</p>' : ''}
		${query.state === 'success' ? `<p class="success">Added to the <strong>${query.team}</strong> Slack.</p>` : ''}

		<a href="https://slack.com/oauth/authorize?scope=commands&client_id=${config.clientId}">
			<img
				alt="Add to Slack" height="40" width="139"
				src="https://platform.slack-edge.com/img/add_to_slack.png"
				srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x"/>
		</a>`
	},

	async '/create'(req, res) {
		const body = await parseSlackBody(req);
		const [question, ...options] = body.text.split(',');
		const id = randomId();

		const poll = {
			id,
			question,
			options: options.map((option, i) => ({
				name: 'option',
				label: option,
				value: i,
				voters: new Set(),
			})),
		};

		polls.set(id, poll);

		return renderPoll(poll);
	},

	async '/respond'(req, res) {
		const {payload} = await parseSlackBody(req);
		const {actions, callback_id, user} = JSON.parse(payload);
		const poll = polls.get(callback_id);

		if(!poll) {
			return send(res, 404, 'Couldn\'t find that poll, sorry.');
		}

		actions.forEach(votePoll(poll, user));
		return renderPoll(poll);
	},

	async '/oauth'(req, res) {
		const {query} = url.parse(req.url, true);

		if(query.error) {
			return redirect(res, '/?state=error');
		}

		const response = await fetch(url.format({
			protocol: 'https',
			hostname: 'slack.com',
			pathname: '/api/oauth.access',
			query: {
				client_id: config.clientId,
				client_secret: config.clientSecret,
				code: query.code,
				redirect_uri: query.redirect_uri,
			}
		}));

		const {ok, team_name} = await response.json();

		if(!ok) {
			return redirect(res, '/?state=error');
		}

		return redirect(res, `/?state=success&team=${encodeURIComponent(team_name)}`);
	}
});
