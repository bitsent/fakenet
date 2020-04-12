const bsv = require('bsv');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;
const RpcClient = require('bitcoin-core');

var FakeTxHandler = require('./FakeTxHandler')

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
    newBlockCallback: () => console.log("NEW BLOCK!")
}

class FakeNet {
    
    constructor(o = defaultOptions) {

        for (const i in defaultOptions)
            if (defaultOptions.hasOwnProperty(i))
                this[i] = o[i]!==undefined? o[i] : defaultOptions[i];

        const _newBlockCallback = o.newBlockCallback || defaultOptions.newBlockCallback;
        this.newBlockCallback = async () => {
            try {
                await _newBlockCallback()
            } catch (error) {
                console.log("newBlockCallback Error: " + error);
            }
        } 
    }

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

        const _rpcClient = new RpcClient({ 
            network: 'regtest', 
            username: this.rpcuser,
            password: this.rpcpassword,
            port: this.rpcport 
        });
        const _broadcast = async (hexTx) => {
            try {
                await _rpcClient.sendRawTransaction(hexTx);
            } catch (error) {
                throw new Error("Failed to broadcast TX: \n" + hexTx + "\n" + error);
            }
        };
        const _fakeTxHandler = new FakeTxHandler(_broadcast)

        this.createTransactions = (count) => _fakeTxHandler.createTransactions(count);

        this.getInfo = async () => await _rpcClient.getBlockchainInfo();
        this.getFunds = (amount) => _fakeTxHandler.getFunds(amount);

        this.broadcast = _broadcast;

        this.mineBlocks = async (count) => {
            await _rpcClient.generate(count);
            var funds = await _rpcClient.getBalance();
            if(funds > 1) {
                var amount = funds - 0.5;
                var priv = bsv.PrivateKey.fromRandom("regtest");
                var addr = bsv.Address.fromPrivateKey(priv).toString();
                var txid = await _rpcClient.sendToAddress(addr, amount);

                var sats = parseInt(amount * 100000000);
                var scriptPubKey = bsv.Script.fromAddress(addr).toHex();
                _fakeTxHandler.addUtxos([{
                    txid: txid, vout: 0, satoshis: sats, scriptPubKey: scriptPubKey, privkey: priv.toString()
                }]);
            }
            return funds;
        }

        if(shouldInitialize){
            return new Promise(async (resolve, reject) => {
                await _fakeTxHandler.reset();
                setTimeout(()=>{
                    try { self.mineBlocks(101); }
                    catch (error) { reject(error); }
                    resolve();
                }, 5000);
                
            })
        }
        else return;
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
            var amountAdded = await self.mineBlocks(1)
            self.newBlockCallback();
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