const bsv = require('bsv');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;

var FakeTxHandler = require('./FakeTxHandler')

var myExec = (command) => {
    return new Promise((resolve,reject)=> {
        console.log(">> RUNNING : " + command);
        exec(command, (err, stdout, stderr) => {
            var toLog = [stdout, stderr].filter(i=>i).join("\n")
            //if(toLog) console.log(toLog);
            if(err) reject(err);
            resolve({stdout, stderr});
        })
    });
};

function awaitableTimeout(func, timeout){
    return new Promise(async (resolve, reject) => {
        setTimeout(async ()=>{
            try { await func() }
            catch (error) { reject(error); }
            resolve();
        }, timeout);
    })
}

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
        "-connect=0"
    ],
    existingContainerId : null,
    tryAttachToLastContainer: false,
    newBlockCallback: (block) => console.log("NEW BLOCK! #" + block.height)
}

class FakeNet {
    
    constructor(o = defaultOptions) {

        for (const i in defaultOptions)
            if (defaultOptions.hasOwnProperty(i))
                this[i] = o[i]!==undefined? o[i] : defaultOptions[i];

        const _newBlockCallback = o.newBlockCallback || defaultOptions.newBlockCallback;
        this.newBlockCallback = async (block) => {
            try {
                await _newBlockCallback(block)
            } catch (error) {
                console.log("newBlockCallback Error: " + error);
            }
        } 
    }

    minerPrivKey = bsv.PrivateKey.fromRandom("regtest");

    getDockerRegtestCMD = function () {
        var paramList = this.bitcoindParams.concat([]);
        paramList.push("-port=" + this.port);
        paramList.push("-rpcport=" + this.rpcport);
        paramList.push("-rpcuser=" + this.rpcuser);
        paramList.push("-rpcpassword=" + this.rpcpassword);
        var paramStr = "" + paramList.map(p=>'"' + p + '"').join(", ");
        return 'CMD ["bitcoind", "-regtest"' + (paramStr? ", " + paramStr: "") + ']';
    }

    getDockerImages = async function () {
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
            var linesFixed = lines.map(l => l.replace(/CMD \[?\"bitcoind\"\]?/, this.getDockerRegtestCMD()))
            fs.writeFileSync(dockerFilePath, linesFixed.join("\n"));
        });
    } 

    setup = async function () {
        if (this.tryAttachToLastContainer === true)
            this.existingContainerId = this.existingContainerId || await this.getLastContainerId();

        var shouldInitialize = !this.existingContainerId
        if (shouldInitialize) {
            var imageName = this.dockerImageName.replace("{version}", this.version);
            var p1 = this.port;
            var p2 = this.rpcport;

            await this.getDockerImages();
            var buildOutput = await myExec("docker build -t " + imageName + " .\\docker-sv\\sv\\" + this.version);
            var runOutput = await myExec("docker run -p " + p1 + ":" + p1 + " -p " + p2 + ":" + p2 + " -d -t " + imageName);

            this.existingContainerId = await this.getLastContainerId();
        }
        
        const self = this;

        const _broadcast = async (hexTx) => {
            try {
                self.executeBitcoinCliCommand(`sendrawtransaction "${hexTx}"`)
            } catch (error) {
                throw new Error("Failed to broadcast TX: \n" + hexTx + "\n" + error);
            }
        };
        const _fakeTxHandler = new FakeTxHandler(_broadcast)

        this.createTransactions = (count) => _fakeTxHandler.createTransactions(count);

        this.getInfo = async () => await _rpcClient.getBlockchainInfo();
        this.getFunds = (amount) => _fakeTxHandler.getFunds(amount);

        this.broadcast = _broadcast;

        var _minerAddr = bsv.Address.fromPrivateKey(self.minerPrivKey).toString();

        
        this.mineBlocks = async (count=1) => {
            var blockHashes = await self.executeBitcoinCliCommand(`generatetoaddress ${count} "${_minerAddr}"`);
            var blockTasks = blockHashes.map(self.registerCoinbaseTx);
            for (let i = 0; i < blockTasks.length; i++)
                await blockTasks[i];
            return blockTasks[blockTasks.length-1];
        }

        this.registerCoinbaseTx = async (blockHash) => {
            var block = await self.executeBitcoinCliCommand(`getblock ${blockHash}`);
            var out = await self.executeBitcoinCliCommand(`gettxout "${block.tx[0]}" 0`);
            _fakeTxHandler.addCoinbaseUtxos([{
                height: block.height,
                txid: block.tx[0],
                vout: 0,
                satoshis: out.value * 100000000,
                scriptPubKey: out.scriptPubKey.hex,
                privkey: self.minerPrivKey.toString()
            }])
            return block;
        }

        if(shouldInitialize){
            await _fakeTxHandler.reset();
            await awaitableTimeout(async () => {
                var block = await self.mineBlocks(101)
                console.log("LOADED : #" + block.height);
            }, 5000);
        }
    }

    executeBitcoinCliCommand = async function (command) {
        var completeCommand = `docker exec ${this.existingContainerId} `+
            `bitcoin-cli -regtest -rpcport=${this.rpcport} -rpcuser=${this.rpcuser} -rpcpassword=${this.rpcpassword} `+
            command;

        var output = await myExec(completeCommand);

        try {
            return JSON.parse(output.stdout);
        } catch (error) {
            return output.stdout;
        }
    }

    getLastContainerId = async function () {
        var out = await myExec("docker ps -l -q");
        var id = out.stdout.trim();
        return id;
    }

    start = async function () {
        if (this.activeLoopId)
            throw new Error("Fakenet is already running.");
        await this.setup();

        const self = this;
        this.activeLoopId = setInterval(async () =>{
            var block = await self.mineBlocks()
            self.newBlockCallback(block);
            await self.createTransactions(self.txCount);
        }, this.blocktime)
    }

    stop = async function () {
        if (!this.activeLoopId)
            throw new Error("Fakenet is already stopped.");
        clearInterval(this.activeLoopId);
        this.activeLoopId = undefined;
    }
}

module.exports = FakeNet;