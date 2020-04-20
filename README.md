
# FakeNet
Run a fake Bitcoin network locally.

(It's basically a RegTest with mock transactions)

# Preparation:

- Install Docker.
- get FakeNet (```npm i --save fakenet```)

# Run

The code bellow will run a Bitcoin Node which will create a new block every minute and will put ~20 transactions in each block.

```js
var FakeNet = require("fakenet");

var fakenet = FakeNet();
fakenet.start();
```

Or If you want to reuse an existing container with Bitcoin RegTest, simply pass the container ID.

```js
var FakeNet = require("fakenet");

var fakenet = FakeNet({
    existingContainerId = "<the container ID>"
});
fakenet.start();
```

# Run with API (& simple GUI)

FakeNet can also be started as a server. This way the library can be used remotely.

```js
var FakeNet = require("fakenet");
FakeNet.service.runService(port=5000);
```

> Unfortunately, the automatic setup still depends on Docker, so for the moment there is no trivial way to run the FakeNet service in its own container.

# Get Some Coins

Running the network is all nice and dandy, but you won't be able to do much with it if you don't get some coins.

This is how to do it:

```js
var FakeNet = require("fakenet");
var fakenet = FakeNet();
fakenet.start();

var utxo = await fakenet.getFunds(10000000);

    // {
    //  privkey:"cVWYdAiCEqn1WPNhgpzd6qeNcWzuD3uHCEjR4KtukoFg68d1Lhyb",
    //  satoshis:10000000,
    //  scriptPubKey:"76a914e91af2e26a31d340a41f739c3e1b562a0d9fa1c888ac",
    //  txid:"07847c9f8cbe0fc69630126e9ca26bc9ab2353279ace12ed699e8c127ce23f03",
    //  vout:0
    // }
```

# Advanced Configuration

You can configure some other properties of FakeNet:

- **blocktime** How often to mine a block (in ms)
- **txCount** How many fake transactions to put in a block
- **version** Which BSV bitcoin node version to run (defaults to "1.0.2")
- **port** What port should bitcoind use (defaults to 8333)
- **rpcport** What port should bitcoind RPC server use (defaults to 8332)
- **dockerImageName** Set a custom name for the docker image (default is "fakenet-sv-{version}" where version gets replaced with the version)
- **rpcuser** Username for the RPC server (default is "fakenet")
- **rpcpassword** Password for the RPC server (default is "fakenet")
- **bitcoindParams** An array of parameters to pass to Bitcoind when starting it. For advanced users.
- **existingContainerId** Skip the setup and connect to an existing container ID running your Bitcoin RegTest node.
- **tryAttachToLastContainer** (*For Testing Purposes*) Attempt to connect to the last created container. This will break if you use Docker for any other purposes than FakeNet.
- **newBlockCallback** A callback that gets called after each mined block.

# Methods

To interact with the fakenet, you can call a bunch of methods.

```js
await fakenet.broadcast(hexTx);                   // broadcast a custom transaction
await fakenet.getInfo();                          // get info about the fakenet chain
await fakenet.getFunds(amount);                   // faucet - get some coins to use
await fakenet.createTransactions(count);          // create some more fake transactions
await fakenet.getDockerImages();                  // prepares Dockerfiles for BSV nodes
await fakenet.setup();                            // initializes the node if needed
await fakenet.executeBitcoinCliCommand(command);  // runs a custom bitcoin-cli command
await fakenet.start();                            // starts the fakenet loop
await fakenet.stop();                             // stops the fakenet loop
```