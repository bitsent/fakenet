const bsv = require('bsv');
var fs = require('fs');
var path = require('path');

var FakeTxHandler = require('./FakeTxHandler')
var myExec = require('./myExec')
var awaitableTimeout = require('./awaitableTimeout')

const defaultOptions = {
    blocktime : 60000, // 1 minute blocks
    txCount : 20, // 20 transactions per block
    version : "1.0.2",
    port : 8333,
    rpcport : 8332,
    dockerImageName : "fakenet-sv-{version}",
    rpcuser:"fakenet",
    rpcpassword:"fakenet",
    bitcoindParams : [
        "-server",
        "-excessiveblocksize=0",
        "-maxstackmemoryusageconsensus=0",
        "-connect=0",
        "-disablewallet=1",
        "-rpcworkqueue=512",
        "-datacarriersize=100000",
        "-limitancestorsize=100000",
        "-limitdescendantsize=100000",
    ],
    existingContainerId : null,
    tryAttachToLastContainer: false,
    newBlockCallback: (block) => console.log(`NEW BLOCK! #${block.height} (${block.tx.length} transactions)`)
}

function FakeNet(o = defaultOptions) {

    blocktime = o.blocktime || defaultOptions.blocktime;
    txCount = o.txCount || defaultOptions.txCount;
    version = o.version || defaultOptions.version;
    port = o.port || defaultOptions.port;
    rpcport = o.rpcport || defaultOptions.rpcport;
    dockerImageName = o.dockerImageName || defaultOptions.dockerImageName;
    rpcuser = o.rpcuser || defaultOptions.rpcuser;
    rpcpassword = o.rpcpassword || defaultOptions.rpcpassword;
    bitcoindParams = o.bitcoindParams || defaultOptions.bitcoindParams;
    existingContainerId = o.existingContainerId || defaultOptions.existingContainerId;
    tryAttachToLastContainer = o.tryAttachToLastContainer || defaultOptions.tryAttachToLastContainer;

    _newBlockCallback = o.newBlockCallback || defaultOptions.newBlockCallback;
    newBlockCallback = async (block) => {
        try { return _newBlockCallback(block); } 
        catch (error) { console.log("newBlockCallback Error: " + error); }
    }

    minerPrivKey = bsv.PrivateKey.fromRandom("regtest");

    activeLoopId = null;
    
    function getDockerRegtestCMD() {
        var paramList = bitcoindParams.concat([]);
        paramList.push("-port=" + port);
        paramList.push("-rpcport=" + rpcport);
        paramList.push("-rpcuser=" + rpcuser);
        paramList.push("-rpcpassword=" + rpcpassword);
        var paramStr = "" + paramList.map(p=>'"' + p + '"').join(", ");
        return 'CMD ["bitcoind", "-regtest"' + (paramStr? ", " + paramStr: "") + ']';
    }

    async function getDockerImages() {
        if(fs.existsSync("docker-sv"))
            require('rimraf').sync("docker-sv");
        await myExec("git clone https://github.com/bitcoin-sv/docker-sv.git docker-sv");

        var contents = fs.readdirSync("./docker-sv/sv/");
        contents.forEach(content => {
            if(!fs.statSync(path.join("./docker-sv/sv/", content)).isDirectory())
                return;
            var dockerFilePath = path.join("./docker-sv/sv/", content, "Dockerfile");
            if(!fs.existsSync(dockerFilePath))
                return;
            var lines = fs.readFileSync(dockerFilePath).toString().split("\n");
            var linesFixed = lines.map(l => l.replace(/CMD \[?\"bitcoind\"\]?/, getDockerRegtestCMD()))
            fs.writeFileSync(dockerFilePath, linesFixed.join("\n"));
        });
    } 

    async function setup() {
        if (tryAttachToLastContainer === true)
            existingContainerId = existingContainerId || await getLastContainerId();

        var shouldInitialize = !existingContainerId
        if (shouldInitialize) {
            var imageName = dockerImageName.replace("{version}", version);
            var p1 = port;
            var p2 = rpcport;

            await getDockerImages();
            var buildOutput = await myExec("docker build -t " + imageName + " .\\docker-sv\\sv\\" + version);
            var runOutput = await myExec("docker run -p " + p1 + ":" + p1 + " -p " + p2 + ":" + p2 + " -d -t " + imageName);

            existingContainerId = await getLastContainerId();
        }
        
        const _broadcast = async (hexTx) => {
            try {
                await executeBitcoinCliCommand(`sendrawtransaction "${hexTx}"`)
            } catch (error) {
                throw new Error("Failed to broadcast TX: \n" + hexTx + "\n" + error);
            }
        };
        const _fakeTxHandler = new FakeTxHandler(_broadcast)

        createTransactions = (count) => _fakeTxHandler.createTransactions(count);

        getInfo = async () => await _rpcClient.getBlockchainInfo();
        getFunds = (amount) => _fakeTxHandler.getFunds(amount);

        broadcast = _broadcast;

        var _minerAddr = bsv.Address.fromPrivateKey(minerPrivKey).toString();

        
        mineBlocks = async (count=1) => {
            var blockHashes = await executeBitcoinCliCommand(`generatetoaddress ${count} "${_minerAddr}"`);
            
            var blocks = [];
            for (let i = 0; i < blockHashes.length; i++)
                blocks.push(await registerCoinbaseTx(blockHashes[i]));
            return blocks[blocks.length - 1];
        }

        registerCoinbaseTx = async (blockHash) => {
            var block = await executeBitcoinCliCommand(`getblock ${blockHash}`);
            var out = await executeBitcoinCliCommand(`gettxout "${block.tx[0]}" 0`);
            _fakeTxHandler.addCoinbaseUtxos([{
                height: block.height,
                txid: block.tx[0],
                vout: 0,
                satoshis: out.value * 100000000,
                scriptPubKey: out.scriptPubKey.hex,
                privkey: minerPrivKey.toString()
            }])
            return block;
        }

        if(shouldInitialize){
            await _fakeTxHandler.reset();
            await awaitableTimeout(async () => {
                var block = await mineBlocks(101)
                console.log("LOADED : #" + block.height);
            }, 5000);
        }
    }

    async function executeBitcoinCliCommand(command, runInWorkerQueue = true) {
        var executeOnBitcoinCli = `docker exec ${existingContainerId} `+
            `bitcoin-cli -regtest -rpcport=${rpcport} -rpcuser=${rpcuser} -rpcpassword=${rpcpassword} `;

        var output = await myExec(executeOnBitcoinCli + command);

        try {
            return JSON.parse(output.stdout);
        } catch (error) {
            return output.stdout;
        }
    }

    async function getLastContainerId() {
        var out = await myExec("docker ps -l -q");
        var id = out.stdout.trim();
        return id;
    }

    async function start() {
        if (activeLoopId)
            throw new Error("Fakenet is already running.");
        await setup();

        var repeatFunction = async () =>{
            try {
                var block = await mineBlocks(1);
                await newBlockCallback(block);
                for (let i = 0; i < txCount; i++)
                    await createTransactions(1);
            } catch (error) {
                console.error(error);
                console.error("STOPPING FAKENET");
                stop();
            }
        }

        activeLoopId = setInterval(repeatFunction, blocktime)
        repeatFunction();
    }

    async function stop() {
        if (!activeLoopId)
            throw new Error("Fakenet is already stopped.");
        clearInterval(activeLoopId);
        activeLoopId = undefined;
    }

    return {
        getDockerRegtestCMD,
        getDockerImages,
        setup,
        executeBitcoinCliCommand,
        getLastContainerId,
        start,
        stop,
    }
}

module.exports = FakeNet;