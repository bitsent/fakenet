var fs = require("fs");
var bsv = require("bsv");

class FakeTxHandler {

    utxoFile = "utxo.json";

    constructor (broadcastFunction = (hexTx) => {
        throw new Error("Broadcast Not Implemented!"); 
    }) {
        this.broadcast = broadcastFunction;
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

    getNewPrivKey = function () { bsv.PrivateKey.fromRandom().toString() }

    asInput = function (obj) {
        return {
            txid: obj.txid.toString(),
            vout: obj.vout,
            amount: obj.amount.toString(),
            scriptPubKey: obj.scriptPubKey.toString(),
            privkey: obj.privkey.toString()
        };
    }

    usingUtxoFile = async function (func = async (utxoData) => { }) {
        utxoData = { coinbaseUtxo: [], utxo: [] }
        if (fs.existsSync(utxoFile))
            utxoData = JSON.parse(await this.readFile(utxoFile));
        var newData = await func(utxoData);
        if (!newData) {
            console.log("No UTXO data retruned. Assuming this was a Read-Only operation.");
            return;
        }
        await this.writeFile(utxoFile)
    }

    addBlockUtxo = async function (coinbaseUtxo) {
        return this.usingUtxoFile(async (utxoData) => {
            utxoData.coinbaseUtxo.concat(coinbaseUtxo.map(utxo=> {
                return{
                    blocksLeft: 100,
                    utxo: this.asInput(utxo)
                }
            }));

            var spendableIndexes = []
            for (let i = 0; i < utxoData.coinbaseUtxo.length; i++) {
                var blocksLeft = utxoData.coinbaseUtxo[i].blocksLeft--;
                if (blocksLeft < 0) spendableIndexes.push(i);
            }
            spendableIndexes = spendableIndexes.sort((a, b) => b - a)
            spendableIndexes.forEach(i => {
                var spendable = utxoData.coinbaseUtxo.splice(i, 1);
                utxoData.utxo.push(spendable.utxo);
            });

            return utxoData;
        });
    }

    createTransaction = function (inputs, changeWif, outputWifArray, perOutputAmount=null, opReturn = null) {
        if (outputWifArray.length < 1)
            throw new Error("outputWifArray cannot be empty!");

        var inAmount = inputs.map(i => parseFloat(i.amount)).reduce((a, b) => a + b, 0);
        perOutputAmount = perOutputAmount || ((inAmount / outputWifArray.length) - 500);

        if(inAmount < 2000)
            throw new Error("Inputs are too small");
        if(perOutputAmount < 1000)
            throw new Error("Outputs are too small");

        var tx = bsv.Transaction();
        tx.from(inputs.map(i => this.asInput(i)));

        for (let i = 1; i < outputWifArray.length; i++)
            tx.to(wifToAddr(outputWifArray[i]), perOutputAmount);

        if (opReturn)
            tx.addData(opReturn);

        var feeNeeded = (tx.toString().length / 2) + 400;
        var change = inAmount - (perOutputAmount * outputWifArray) - feeNeeded
        var sendChange = change > 1000

        if (change < 0)
            throw new Error("Not enough Funds")
        if (sendChange)
            tx.to(wifToAddr(changeWif), change)

        for (let i = 1; i < inputs.length; i++)
            tx.sign(inputs[i].privkey);

        if(sendChange)
            tx.sign(changeWif); 

        var utxo = outputWifArray.forEach((wif, i) => {
            return {
                txid: tx.hash,
                vout: i,
                amount: tx.outputs[i].satoshis,
                scriptPubKey: tx.outputs[i].script.toHex(),
                privkey: wif
            }
        });

        if (sendChange) {
            var changeVout = tx.outputs.length-1;
            var changeScript = tx.outputs[changeVout];
            utxo.push({ txid: tx.hash, vout: changeVout, amount: change, scriptPubKey: changeScript, privkey: changeWif });
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
                return []; // no inputs

            for (let i = 0; i < count; i++) {
                var inputs = [];
                var outputWifArray = [];
                var opReturn = null;

                inputs.push(utxoData.utxo.splice(this.getRandomIndex(utxoData.utxo.length), 1));
                while (utxoData.utxo.length > 0 && this.checkChance(chances.plusOneInputChance))
                    inputs.push(utxoData.utxo.splice(this.getRandomIndex(utxoData.utxo.length), 1));

                outputWifArray.push(this.getNewPrivKey());
                while (this.checkChance(chances.plusOneOutputChance))
                    outputWifArray.push(this.getNewPrivKey());

                if (this.checkChance(chances.opReturnOutputChance))
                    opReturns.push(opReturnTexts[this.getRandomIndex(opReturnTexts.length)]);

                var tx = this.createTransaction(inputs, outputWifArray[0], outputWifArray, null, opReturn)
                transactions.push(tx.hex);
                utxoData.utxo = utxoData.utxo.concat(tx.utxo);
            }

            utxoData.utxo = utxo.sort((a, b) => a.amount - b.amount);

            var utxoMergeCount = 0;
            for (let i = 0; i < utxoData.utxo.length; i++)
                if (utxoData.utxo[i].amount < this.settings.autoMergeUTXOLowerThan)
                    utxoMergeCount = i + 1
                else break;

            if (this.checkChance(chances.groupSmallerHalfUtxosChance))
                utxoMergeCount = Math.max(utxoMergeCount, utxoData.utxo.length / 2 | 0)

            if (utxoMergeCount > 1) {
                var inputs = utxoData.utxo.splice(0, utxoMergeCount);
                var wif = this.getNewPrivKey();
                var tx = this.createTransaction(inputs, wif, [wif])
                transactions.push(tx.hex);
                utxoData.utxo = utxoData.utxo.concat(tx.utxo);
            }

            for (let i = 0; i < transactions.length; i++)
                this.broadcast(transactions[i]);

            return utxoData;
        })
        return transactions.length;
    }

    getFunds = async function (amount) {
        resultUtxo = null;
        await this.usingUtxoFile(async (utxoData) => {
            if (utxoData.length == 0)
                return []; // no inputs

            utxoData.utxo = utxo.sort((a, b) => a.amount - b.amount);

            var takeTillIndex = 0;
            var amountToTake = 0
            for (let i = 0; i < utxoData.utxo.length; i++) {
                takeTillIndex=i;
                amountToTake += utxoData.utxo.amount;
                if (amountToTake > amount + 5000)
                    break;
            }

            if (takeTillIndex >= 1) {
                var inputs = utxoData.utxo.splice(0, utxoMergeCount);
                var wif = this.getNewPrivKey();
                var changeWif = this.getNewPrivKey();

                var tx = this.createTransaction(inputs, changeWif, [wif], amount);
                this.broadcast(tx.hex);

                resultUtxo = tx.utxo.splice(0,1);
                utxoData.utxo = utxoData.utxo.concat(tx.utxo);
            }

            return utxoData;
        })
        return resultUtxo;
    }
}

module.exports = FakeTxHandler;