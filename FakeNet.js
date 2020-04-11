const bsv = require('bsv');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;

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
    txCount : 30, // 30 transactions per block
    version : "1.0.2",
    port : 8333,
    rpcPort : 8332,
    dockerImageName : "fakenet-sv-{version}",
    bitcoindParams : [
        "-server",
        "-excessiveblocksize=0",
        "-maxstackmemoryusageconsensus=0",
        "-rpcuser=fakenet",
        "-rpcpassword=fakenet",
        "-connect=0"
    ], 
    existingContainerId : null
}

class FakeNet {
    

    constructor(o = defaultOptions) {
        this.blocktime = o.blocktime || defaultOptions.blocktime;
        this.txCount = o.txCount || defaultOptions.txCount;
        this.version = o.version || defaultOptions.version;
        this.port = o.port || defaultOptions.port;
        this.rpcPort = o.rpcPort || defaultOptions.rpcPort;
        this.dockerImageName = o.dockerImageName || defaultOptions.dockerImageName;
        this.bitcoindParams = o.bitcoindParams || defaultOptions.bitcoindParams;
        this.existingContainerId = o.existingContainerId || defaultOptions.existingContainerId;

    }

    getDockerRegtestCMD = function () {
        var paramList = this.bitcoindParams.concat([]);
        paramList.push("-port=" + this.port);
        paramList.push("-rpcport=" + this.rpcPort);
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
        this.activeLoopId = setInterval(this.loopFunction, this.blocktime)
    }

    loopFunction = async function () {
        console.log("loopFunction called...");

        // TODO: Loop
        //     Mine block with a random fake miner.
        //     >> cb:blockMinedCallback(blockData)
        //     Read prev UTXO file
        //     Create keys
        //     Move prev Funds to new destinations
        //     Add custom transactions if configured
        //     >> cb:customTransactionCallback(bsv, spendableInputs, doneCallback)
        //     Save UTXOs to file
    }

    stop = async function () {
        if (!this.activeLoopId)
            throw new Error("Fakenet is already stopped.");
        clearInterval(this.activeLoopId);
        this.activeLoopId = undefined;
    }
}

module.exports = FakeNet;