const utils = require('./utils');
const config = require('./config');
const steem_interface = require('./steem-interface');
const ecc = require('eosjs-ecc');
var express = require('express');
var steem = require('steem');
var app = express();
var port = process.env.PORT || config.api_port

app.use(function(req, res, next) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	next();
});

app.listen(port, () => utils.log(`API running on port: ${port}`));

app.get('/api/create_account', async (req, res) => {
	// Make sure a timestamp is present
	if(!req.query.ts || isNaN(parseInt(req.query.ts))) {
		res.json({ success: false, error: 'Missing or invalid timestamp.' });
		return;
	}

	// Make sure the request was generated within the last 10 minutes
	if(Date.now() - parseInt(req.query.ts) > 10 * 60 * 1000) {
		res.json({ success: false, error: 'Request has expired.' });
		return;
	}

	// Validate the account name
	if(steem.utils.validateAccountName(req.query.account_name)) {
		res.json({ success: false, error: `Invalid account name specified: @${req.query.account_name}` });
		return;
	}

	// Make sure the account name is not already taken
	var result = await steem_interface.database('get_accounts', [[req.query.account_name]]);

	if(result && result.length > 0) {
		res.json({ success: false, error: `Account name: @${req.query.account_name} is already taken.` });
		return;
	}

	// Verify the signature to confirm the request came from the @dact account
	try {
		if(ecc.recover(req.query.signature, `${req.query.account_name}:${req.query.ts}`).slice(3) != config.dact_pub_key.slice(3)) {
			res.json({ success: false, error: 'Invalid signature.' });
			return;
		}
	} catch (err) {
		res.json({ success: false, error: 'Invalid signature.' });
		return;
	}

	// Create the account	
	var params = { 
		creator: config.account, 
		new_account_name: req.query.account_name,
		owner: { weight_threshold: 1, account_auths: [], key_auths: [[req.query.owner_pub_key, 1]] },
		active: { weight_threshold: 1, account_auths: [], key_auths: [[req.query.active_pub_key, 1]] },
		posting: { weight_threshold: 1, account_auths: [], key_auths: [[req.query.posting_pub_key, 1]] },
		memo_key: req.query.memo_pub_key,
		json_metadata: '',
		extensions: []
	};

	try {
		var result = await steem_interface.broadcast('create_claimed_account', params, config.active_key);
		res.json(result);
	} catch(err) {
		res.json({ success: false, error: err });
		return;
	}
});