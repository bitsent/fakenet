const bsv = require('bsv');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;

var FakeTxHandler = require('./FakeTxHandler')
var nodeRequests = require('./nodeRequests')

var myExec = (command) => {
    return new Promise((resolve,reject)=> {
        console.log(">> START RUNNING : " + command);
        exec(command, (err, stdout, stderr) => {
            if(stdout) console.log(stdout);
            if(stderr) console.log(stderr);
            console.log("<< DONE RUNNING : " + command);
            if(err) reject(err);
            resolve({stdout, stderr});
        })
    });
};

const defaultOptions = {
    blocktime : 60000, // 1 minute blocks
    txCount : 20, // 20 transactions per block
    version : "1.0.2",
    port : 8333,
    rpcPort : 8332,
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
    newBlockCallback: (block) => console.log(block)
}

class FakeNet {
    
    constructor(o = defaultOptions) {
        this.blocktime = o.blocktime || defaultOptions.blocktime;
        this.txCount = o.txCount || defaultOptions.txCount;
        this.version = o.version || defaultOptions.version;
        this.port = o.port || defaultOptions.port;
        this.rpcPort = o.rpcPort || defaultOptions.rpcPort;
        this.rpcuser = o.rpcuser || defaultOptions.rpcuser;
        this.rpcpassword = o.rpcpassword || defaultOptions.rpcpassword;
        this.dockerImageName = o.dockerImageName || defaultOptions.dockerImageName;
        this.bitcoindParams = o.bitcoindParams || defaultOptions.bitcoindParams;
        this.existingContainerId = o.existingContainerId || defaultOptions.existingContainerId;

        const _newBlockCallback = o.newBlockCallback || defaultOptions.newBlockCallback;
        this.newBlockCallback = async (block) => {
            try {
                await _newBlockCallback(block)
            } catch (error) {
                console.log("newBlockCallback Error: " + error);
            }
        } 
    }

    getDockerRegtestCMD = function () {
        var paramList = this.bitcoindParams.concat([]);
        paramList.push("-port=" + this.port);
        paramList.push("-rpcport=" + this.rpcPort);
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
        if (!this.existingContainerId) {
            var imageName = this.dockerImageName.replace("{version}", this.version);
            var p1 = this.port;
            var p2 = this.rpcPort;

            await this.getDockerImages();
            var buildOutput = await myExec("docker build -t " + imageName + " .\\docker-sv\\sv\\" + this.version);
            var runOutput = await myExec("docker run -p " + p1 + ":" + p1 + " -p " + p2 + ":" + p2 + " -d -t " + imageName);
        }

        this.existingContainerId = this.existingContainerId || await this.getLastContainerId();

        const self = this;
        const _broadcast = async (hexTx) => await nodeRequests.broadcast("127.0.0.1", self.rpcPort, hexTx);

        this.fakeTxHandler = new FakeTxHandler(_broadcast)

        this.broadcast = _broadcast;
        this.addBlockUtxo = (coinbaseUtxo) => this.fakeTxHandler.addBlockUtxo(coinbaseUtxo);
        this.createTransactions = (count) => this.fakeTxHandler.createTransactions(count);
        this.getFunds = (amount) => this.fakeTxHandler.getFunds(amount);

        this.mineBlocks = async (count) => {
            var response = await nodeRequests.mine("127.0.0.1", self.rpcPort, count, self.rpcpassword);
            console.log("Mined " + count + " blocks!\n" + JSON.stringify(response));
            // TODO: create UTXO objects
            // TODO: call 'self.fakeTxHandler.addBlockUtxo'
            return response;
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
            var block = await self.mineBlocks(1)
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