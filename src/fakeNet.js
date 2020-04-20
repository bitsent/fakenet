const bsv = require('bsv');
var fs = require('fs');
var path = require('path');

var FakeTxHandler = require('./fakeTxHandler')
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
    newBlockCallback: (block) => console.log(`NEW BLOCK! #${block.height} (${block.tx.length} transactions)`),
    runBitcoindLocally : false,
    bitcoindPath : ".",
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
    runBitcoindLocally = o.runBitcoindLocally || defaultOptions.runBitcoindLocally;
    bitcoindPath = o.bitcoindPath || defaultOptions.bitcoindPath;
    
    _setupCalled = false
    _setupDone = false
    _activeLoopId = null;
    _fakeTxHandler = new FakeTxHandler(broadcast);
    _minerPrivKey = bsv.PrivateKey.fromRandom("regtest");
    _minerAddr = bsv.Address.fromPrivateKey(_minerPrivKey).toString();
    _newBlockCallback = o.newBlockCallback || defaultOptions.newBlockCallback;

    async function newBlockCallback(block) {
        try { return await _newBlockCallback(block); } 
        catch (error) { console.log("newBlockCallback Error: " + error); }
    }

    async function broadcast(hexTx) {
        try { return await executeBitcoinCliCommand(`sendrawtransaction "${hexTx}"`); }
        catch (error) { throw new Error("Failed to broadcast TX: \n" + hexTx + "\n" + error); }
    }

    async function getInfo() { return await executeBitcoinCliCommand(`getinfo`); }

    async function getFunds(amount) { return await _fakeTxHandler.getFunds(amount); }

    async function createTransactions(count) { return await _fakeTxHandler.createTransactions(count); }

    async function mineBlocks(count=1) {
        var blockHashes = await executeBitcoinCliCommand(`generatetoaddress ${count} "${_minerAddr}"`);
        
        var blocks = [];
        for (let i = 0; i < blockHashes.length; i++)
            blocks.push(await registerCoinbaseTx(blockHashes[i]));
        return blocks[blocks.length - 1];
    }

    async function registerCoinbaseTx(blockHash) {
        var block = await executeBitcoinCliCommand(`getblock ${blockHash}`);
        var out = await executeBitcoinCliCommand(`gettxout "${block.tx[0]}" 0`);
        _fakeTxHandler.addCoinbaseUtxos([{
            height: block.height,
            txid: block.tx[0],
            vout: 0,
            satoshis: out.value * 100000000,
            scriptPubKey: out.scriptPubKey.hex,
            privkey: _minerPrivKey.toString()
        }])
        return block;
    }
    
    function getRegtestStartCommand(){
        var paramList = bitcoindParams.concat([]);
        paramList.push("-daemon");
        paramList.push("-port=" + port);
        paramList.push("-rpcport=" + rpcport);
        paramList.push("-rpcuser=" + rpcuser);
        paramList.push("-rpcpassword=" + rpcpassword);
        var paramStr = "" + paramList.join(", ");
        return 'bitcoind -regtest ' + (paramStr? ", " + paramStr: "");
    }

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

    async function checkSetupStatus()
    {
        return {
            called: _setupCalled,
            done: _setupDone
        };
    }

    async function setup() {
        if (_setupCalled)
            throw new Error("Setup already called");
        _setupCalled = true;

        if (!runBitcoindLocally && tryAttachToLastContainer)
            existingContainerId = existingContainerId || await getLastContainerId();

        if (runBitcoindLocally) {
            var command = getRegtestStartCommand();
            await myExec(command);
            existingContainerId = null;
        }
        else if (!existingContainerId) {
            var imageName = dockerImageName.replace("{version}", version);
            await getDockerImages();
            await myExec("docker build -t " + imageName + " .\\docker-sv\\sv\\" + version);
            await myExec("docker run -p " + port + ":" + port + " -p " + rpcport + ":" + rpcport + " -d -t " + imageName);
            existingContainerId = await getLastContainerId();
        }
        
        if(runBitcoindLocally || !tryAttachToLastContainer){
            await _fakeTxHandler.reset();
            await awaitableTimeout(async () => {
                var block = await mineBlocks(101)
                console.log("LOADED : #" + block.height);
            }, 5000);
        }

        console.log("SETUP DONE");
        _setupDone=true;
    }

    async function executeBitcoinCliCommand(command) {
        var executeOnBitcoinCli = ` -regtest -rpcport=${rpcport} -rpcuser=${rpcuser} -rpcpassword=${rpcpassword} `;
        if(runBitcoindLocally) executeOnBitcoinCli = path.join(bitcoindPath, "bitcoin-cli") + executeOnBitcoinCli
        else executeOnBitcoinCli = `docker exec ${existingContainerId} bitcoin-cli` + executeOnBitcoinCli;
        
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
        if (_activeLoopId)
            throw new Error("Fakenet is already running.");
        if(!_setupCalled)
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

        _activeLoopId = setInterval(repeatFunction, blocktime)
        repeatFunction();
    }

    async function isRunning() {
        return !!_activeLoopId;
    }

    async function stop() {
        if (!_activeLoopId)
            throw new Error("Fakenet is already stopped.");
        clearInterval(_activeLoopId);
        _activeLoopId = undefined;
    }

    return {
        executeBitcoinCliCommand,
        createTransactions,
        getDockerImages,
        checkSetupStatus,
        setup,
        start,
        stop,
        isRunning,
        getInfo,
        getFunds,
        mineBlocks,
        broadcast,
    }
}

FakeNet.defaultOptions = defaultOptions;

FakeNet.getDockerImages = async function getDockerImages() {
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
        var linesFixed = lines.map(l => l.replace(/CMD \[?\"bitcoind\"\]?/, 'CMD ["node", "service.js"]'))
        fs.writeFileSync(dockerFilePath, linesFixed.join("\n"));
    });
}



module.exports = FakeNet;

