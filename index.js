var FakeNet = require("./FakeNet")

// CODE FOR MANUAL TEST - // TODO: DELETE

    var fakenet = new FakeNet({
        blocktime : 50000,
        txCount : 20,
    });

    (async function () {
        await fakenet.start();
        console.log("FakeNet Started");

        setTimeout(async () => {
            const Client = require('bitcoin-core');
            const client = new Client({ username: 'fakenet', password: 'fakenet', port: 8332 });
            console.log(JSON.stringify(await client.getBlockchainInfo()));
        }, 5000);
    })();

// CODE FOR MANUAL TEST - // TODO: DELETE

module.exports = FakeNet