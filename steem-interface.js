const utils = require('./utils');
const config = require('./config');
const dsteem = require('dsteem');

var clients = config.rpc_nodes.map(n => new dsteem.Client(n, { timeout: 1000 }));

async function database(method_name, params) { return await call('database', method_name, params); }
async function broadcast(method_name, params, key) { return await call('broadcast', method_name, params, key); }

async function call(api, method_name, params, key) {
	var result = null;

	for(var i = 0; i < clients.length; i++) {
		if(clients[i].sm_disabled) {
			// Check how recently the node was disabled and re-enable if it's been over an hour
			if(clients[i].sm_last_error_date > Date.now() - 60 * 60 * 1000)
				continue;
			else
				clients[i].sm_disabled = false;
		}

		result = api == 'broadcast' ?
			await tryBroadcast(clients[i], method_name, params, key) :
			await tryDatabaseCall(clients[i], method_name, params);

		if(result.success)
			return result.result;
	}
	
	utils.log('All nodes failed calling [' + method_name + ']!', 1, 'Red');
	return result;
}

async function tryDatabaseCall(client, method_name, params) {
	return await client.database.call(method_name, params)
		.then(async result => { return { success: true, result: result } })
		.catch(async err => { 
			utils.log('Error calling [' + method_name + '] from node: ' + client.address + ', Error: ' + err, 1, 'Yellow');

			// Record that this client had an error
			updateClientErrors(client);

			return { success: false, error: err } 
		});
}

async function tryBroadcast(client, op_name, params, key) {
	var op = [op_name, params];

	return await client.broadcast.sendOperations([op], dsteem.PrivateKey.fromString(key))
		.then(async result => { return { success: true, result: result } })
		.catch(async err => { 
			utils.log('Error broadcasting operation [' + op_name + '] from node: ' + client.address + ', Error: ' + err, 1, 'Yellow');

			// Record that this client had an error
			updateClientErrors(client);

			return { success: false, error: err } 
		});
}

function updateClientErrors(client) {
	// Check if the client has had errors within the last 10 minutes
	if(client.sm_last_error_date && client.sm_last_error_date > Date.now() - 10 * 60 * 1000)
		client.sm_errors++;	
	else
		client.sm_errors = 1;

	client.sm_last_error_date = Date.now();

	if(client.sm_errors >= config.rpc_error_limit) {
		utils.log('Disabling node: ' + client.address + ' due to too many errors!', 1, 'Red');
		client.sm_disabled = true;
	}

	// If all clients have been disabled, we're in trouble, but just try re-enabling them all
	if(!clients.find(c => !c.sm_disabled)) {
		utils.log('All clients disabled!!! Re-enabling them...', 1, 'Red');
		clients.forEach(c => c.sm_disabled = false);
	}
}

module.exports = {
	database: database,
	broadcast: broadcast
}