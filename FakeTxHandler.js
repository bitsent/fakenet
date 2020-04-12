var fs = require("fs");
var bsv = require("bsv");
var Lock = require("lock-taskqueue");

class FakeTxHandler {

    utxoFile = "utxo.json";

    constructor (broadcastFunction = (hexTx) => {
        throw new Error("Broadcast Not Implemented!"); 
    }) {
        this.broadcast = broadcastFunction;
        this.utxoLock = Lock();
    }
    
    chances = {
        plusOneInputChance: 0.33,
        plusOneOutputChance: 0.40,
        opReturnOutputChance: 0.10,
        groupSmallerHalfUtxosChance: 0.01,
    }

    settings = {
        autoMergeUTXOLowerThan: 20000,
    }

    opReturnTexts = [
        "Hello World!",
        "Anyone listening?",
        "What is love?",
        "The answer is 42",
        "宇宙，生命以及其他一切的答案是什么？"
    ]

    readFile = async function (path) { return new Promise((resolve, reject) => { fs.readFile(path, (err, data) => { err ? reject(err) : resolve(data) }) }) }
    writeFile = async function (path, text) { return new Promise((resolve, reject) => { fs.writeFile(path, text, (err, data) => { err ? reject(err) : resolve(data) }) }) }

    getRandomIndex = function (len) { return Math.floor(Math.random() * len); }
    checkChance = function (chance) { return Math.random() <= chance; }

    getNewPrivKey = () => bsv.PrivateKey.fromRandom("regtest").toString();
    wifToAddr = (wif) => bsv.Address.fromPrivateKey(bsv.PrivateKey.fromWIF(wif)).toString();
    
    asInput = function (obj) {
        return {
            txid: obj.txid.toString(),
            vout: parseInt(obj.vout),
            satoshis: parseInt(obj.satoshis),
            scriptPubKey: obj.scriptPubKey.toString(),
            privkey: obj.privkey.toString()
        };
    }

    usingUtxoFile = async (func) => {
        this.utxoLock(async () => {
            var utxoData = []
            if (fs.existsSync(this.utxoFile))
                utxoData = JSON.parse(await this.readFile(this.utxoFile));
            var newData = await func(utxoData);
            if (newData === undefined) {
                console.log("No UTXO data retruned. Assuming this was a Read-Only operation.");
                return;
            }
            await this.writeFile(this.utxoFile, JSON.stringify(newData, null, 4));
        });
    }

    addUtxos = async function (utxoArray) {
        return this.usingUtxoFile(async (utxoData) => {
            utxoData = utxoData.concat(utxoArray.map(this.asInput));
            return utxoData;
        });
    }

    reset = async function () {
        return this.usingUtxoFile(async () => {
            return [];
        });
    }

    createTransaction = function (inputs, changeWif, outputWifArray, perOutputAmount=null, opReturn = null) {
        if (outputWifArray.length < 1)
            throw new Error("outputWifArray cannot be empty!");

        var inAmount = inputs.map(i => parseFloat(i.satoshis)).reduce((a, b) => a + b, 0);
        perOutputAmount = parseInt(perOutputAmount || ((inAmount / outputWifArray.length) - 500));

        if(inAmount < 2000)
            throw new Error("Inputs are too small");
        if(perOutputAmount < 1000)
            throw new Error("Outputs are too small");

        var tx = bsv.Transaction();
        for (let i = 0; i < inputs.length; i++)
            tx.from(this.asInput(inputs[i]));

        for (let i = 0; i < outputWifArray.length; i++)
            tx.to(this.wifToAddr(outputWifArray[i]), perOutputAmount);

        if (opReturn)
            tx.addData(opReturn);

        var feeNeeded = (tx.toString().length / 2) + 400;
        var change = inAmount - (perOutputAmount * outputWifArray) - feeNeeded
        var sendChange = change > 1000

        if (change < 0)
            throw new Error("Not enough Funds")
        if (sendChange)
            tx.to(this.wifToAddr(changeWif), change)

        for (let i = 1; i < inputs.length; i++)
            tx.sign(inputs[i].privkey);

        if(sendChange)
            tx.sign(changeWif); 

        var utxo = outputWifArray.map((wif, i) => {
            return {
                txid: tx.hash,
                vout: i,
                satoshis: tx.outputs[i].satoshis,
                scriptPubKey: tx.outputs[i].script.toHex(),
                privkey: wif
            }
        });

        if (sendChange) {
            var changeVout = tx.outputs.length-1;
            var changeScript = tx.outputs[changeVout];
            utxo.push({ txid: tx.hash, vout: changeVout, satoshis: change, scriptPubKey: changeScript, privkey: changeWif });
        }

        return {
            hex: tx.toString(),
            utxo: utxo
        }
    }

    createTransactions = async function (count) {
        var transactions = [];
        await this.usingUtxoFile(async (utxoData) => {
            if (utxoData.length == 0)
                return; // no change

            for (let i = 0; i < count; i++) {
                var inputs = [];
                var outputWifArray = [];
                var opReturn = null;

                inputs.push(utxoData.splice(this.getRandomIndex(utxoData.length), 1)[0]);
                while (utxoData.length > 0 && this.checkChance(this.chances.plusOneInputChance))
                    inputs.push(utxoData.splice(this.getRandomIndex(utxoData.length), 1)[0]);

                outputWifArray.push(this.getNewPrivKey());
                while (this.checkChance(this.chances.plusOneOutputChance))
                    outputWifArray.push(this.getNewPrivKey());

                if (this.checkChance(this.chances.opReturnOutputChance))
                    opReturn = this.opReturnTexts[this.getRandomIndex(this.opReturnTexts.length)];

                var tx = this.createTransaction(inputs, outputWifArray[0], outputWifArray, null, opReturn)
                transactions.push(tx.hex);
                utxoData = utxoData.concat(tx.utxo);
            }

            utxoData = utxoData.sort((a, b) => a.satoshis - b.satoshis);

            var utxoMergeCount = 0;
            for (let i = 0; i < utxoData.length; i++)
                if (utxoData[i].satoshis < this.settings.autoMergeUTXOLowerThan)
                    utxoMergeCount = i + 1
                else break;

            if (this.checkChance(this.chances.groupSmallerHalfUtxosChance))
                utxoMergeCount = Math.max(utxoMergeCount, utxoData.length / 2 | 0)

            if (utxoMergeCount > 1) {
                var inputs = utxoData.splice(0, utxoMergeCount);
                var wif = this.getNewPrivKey();
                var tx = this.createTransaction(inputs, wif, [wif])
                transactions.push(tx.hex);
                utxoData = utxoData.concat(tx.utxo);
            }

            for (let i = 0; i < transactions.length; i++)
                this.broadcast(transactions[i]);

            return utxoData;
        })
        return transactions.length;
    }

    getFunds = async function (satoshis) {
        resultUtxo = null;
        await this.usingUtxoFile(async (utxoData) => {
            if (utxoData.length == 0)
                return []; // no inputs

            utxoData = utxo.sort((a, b) => a.satoshis - b.satoshis);

            var takeTillIndex = 0;
            var amountToTake = 0
            for (let i = 0; i < utxoData.length; i++) {
                takeTillIndex=i;
                amountToTake += utxoData.satoshis;
                if (amountToTake > satoshis + 5000)
                    break;
            }

            if (takeTillIndex >= 1) {
                var inputs = utxoData.splice(0, utxoMergeCount);
                var wif = this.getNewPrivKey();
                var changeWif = this.getNewPrivKey();

                var tx = this.createTransaction(inputs, changeWif, [wif], satoshis);
                this.broadcast(tx.hex);

                resultUtxo = tx.utxo.splice(0,1)[0];
                utxoData = utxoData.concat(tx.utxo);
            }

            return utxoData;
        })
        return resultUtxo;
    }
}

module.exports = FakeTxHandler;