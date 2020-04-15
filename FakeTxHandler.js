var fs = require("fs");
var bsv = require("bsv");
var Lock = require("lock-taskqueue");

default_utxoFile = "utxo.json";
default_utxoCoinbaseFile = "utxo_coinbase.json";
default_chances = {
    plusOneInputChance: 0.33,
    plusOneOutputChance: 0.40,
    opReturnOutputChance: 0.10,
    groupSmallerHalfUtxosChance: 0.01,
}
default_settings = {
    autoMergeUTXOLowerThan: 20000,
}
default_opReturnTexts = [
    "Hello World!",
    "Anyone listening?",
    "What is love?",
    "The answer is 42",
    "宇宙，生命以及其他一切的答案是什么？"
]

function FakeTxHandler(broadcastFunction, o = {
        chances : default_chances,
        settings : default_settings,
        utxoFile : default_utxoFile,
        opReturnTexts : default_opReturnTexts,
        utxoCoinbaseFile : default_utxoCoinbaseFile,
    }) {

    chances = o.chances || default_chances;
    settings = o.settings || default_settings;
    utxoFile = o.utxoFile || default_utxoFile;
    opReturnTexts = o.opReturnTexts || default_opReturnTexts;
    utxoCoinbaseFile = o.utxoCoinbaseFile || default_utxoCoinbaseFile;

    broadcast = broadcastFunction;
    utxoLock = Lock();
    utxoCoinbaseLock = Lock();

    async function readFile(path) { return new Promise((resolve, reject) => { fs.readFile(path, (err, data) => { err ? reject(err) : resolve(data) }) }) }
    async function writeFile(path, text) { return new Promise((resolve, reject) => { fs.writeFile(path, text, (err, data) => { err ? reject(err) : resolve(data) }) }) }
    function getRandomIndex(len) { return Math.floor(Math.random() * len); }
    function checkChance(chance) { return Math.random() <= chance; }
    function getNewPrivKey() { return bsv.PrivateKey.fromRandom("regtest").toString(); }
    function wifToAddr(wif) { return bsv.Address.fromPrivateKey(bsv.PrivateKey.fromWIF(wif)).toString(); }

    function asInput(obj) {
        return {
            txid: obj.txid.toString(),
            vout: parseInt(obj.vout),
            satoshis: parseInt(obj.satoshis),
            scriptPubKey: obj.scriptPubKey.toString(),
            privkey: obj.privkey.toString()
        };
    }

    async function usingJsonFile(func, file, lock) {
        lock(async () => {
            var data = []
            if (fs.existsSync(file))
                data = JSON.parse(await readFile(file));
            var newData = await func(data);
            if (newData === undefined) {
                console.log(`No changes made to ${file}.`);
                return;
            }
            await writeFile(file, JSON.stringify(newData, null, 4));
        });
    }

    async function usingUtxoFile(func) {
        return usingJsonFile(func, utxoFile, utxoLock);
    }

    async function usingUtxoCoinbaseFile(func) {
        return usingJsonFile(func, utxoCoinbaseFile, utxoCoinbaseLock);
    }

    async function addSpendableUtxos(utxoArray) {
        return usingUtxoFile(utxoData => {
            return utxoData.concat(utxoArray);
        });
    }

    async function addCoinbaseUtxos(utxoArray) {
        return usingUtxoCoinbaseFile(async (utxoData) => {
            utxoData = utxoData.concat(utxoArray);
            utxoData = utxoData.sort(i => i.height);

            var maxHeight = utxoData[utxoData.length - 1].height;
            var index = 0;
            for (let i = 0; i < utxoData.length; i++)
                if (utxoData[i].height < maxHeight - 100)
                    index++;
            var spendableUtxo = utxoData.splice(0, index);
            addSpendableUtxos(spendableUtxo);

            return utxoData;
        });
    }

    async function reset() {
        await usingUtxoFile(() => []);
        await usingUtxoCoinbaseFile(() => []);
    }

    function createTransaction(inputs, changeWif, outputWifArray, perOutputAmount = null, opReturn = null) {
        if (outputWifArray.length < 1)
            throw new Error("outputWifArray cannot be empty!");

        var inAmount = inputs.map(i => parseFloat(i.satoshis)).reduce((a, b) => a + b, 0);
        perOutputAmount = parseInt(perOutputAmount || ((inAmount / outputWifArray.length) - 500));

        if (inAmount < 2000)
            throw new Error("Inputs are too small");
        if (perOutputAmount < 1000)
            throw new Error("Outputs are too small");

        var tx = bsv.Transaction();
        for (let i = 0; i < inputs.length; i++)
            tx.from(asInput(inputs[i]));

        for (let i = 0; i < outputWifArray.length; i++)
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

        if (sendChange)
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
            var changeVout = tx.outputs.length - 1;
            var changeScript = tx.outputs[changeVout];
            utxo.push({ txid: tx.hash, vout: changeVout, satoshis: change, scriptPubKey: changeScript, privkey: changeWif });
        }

        return {
            hex: tx.toString(),
            utxo: utxo
        }
    }

    async function createTransactions(count) {
        var transactions = [];
        await usingUtxoFile(async (utxoData) => {
            if (utxoData.length == 0)
                return; // no change

            for (let i = 0; i < count; i++) {
                var inputs = [];
                var outputWifArray = [];
                var opReturn = null;

                inputs.push(utxoData.splice(getRandomIndex(utxoData.length), 1)[0]);
                while (utxoData.length > 0 && checkChance(chances.plusOneInputChance))
                    inputs.push(utxoData.splice(getRandomIndex(utxoData.length), 1)[0]);

                outputWifArray.push(getNewPrivKey());
                while (checkChance(chances.plusOneOutputChance))
                    outputWifArray.push(getNewPrivKey());

                if (checkChance(chances.opReturnOutputChance))
                    opReturn = opReturnTexts[getRandomIndex(opReturnTexts.length)];

                var tx = createTransaction(inputs, outputWifArray[0], outputWifArray, null, opReturn)
                transactions.push(tx.hex);
                utxoData = utxoData.concat(tx.utxo);
            }

            utxoData = utxoData.sort((a, b) => a.satoshis - b.satoshis);

            var utxoMergeCount = 0;
            for (let i = 0; i < utxoData.length; i++)
                if (utxoData[i].satoshis < settings.autoMergeUTXOLowerThan)
                    utxoMergeCount = i + 1
                else break;

            if (checkChance(chances.groupSmallerHalfUtxosChance))
                utxoMergeCount = Math.max(utxoMergeCount, utxoData.length / 2 | 0)

            if (utxoMergeCount > 1) {
                var inputs = utxoData.splice(0, utxoMergeCount);
                var wif = getNewPrivKey();
                var tx = createTransaction(inputs, wif, [wif])
                transactions.push(tx.hex);
                utxoData = utxoData.concat(tx.utxo);
            }

            for (let i = 0; i < transactions.length; i++)
                /*await*/ broadcast(transactions[i]);

            return utxoData;
        })
        return transactions.length;
    }

    async function getFunds(satoshis) {
        resultUtxo = null;
        await usingUtxoFile(async (utxoData) => {
            if (utxoData.length == 0)
                return []; // no inputs

            utxoData = utxo.sort((a, b) => a.satoshis - b.satoshis);

            var takeTillIndex = 0;
            var amountToTake = 0
            for (let i = 0; i < utxoData.length; i++) {
                takeTillIndex = i;
                amountToTake += utxoData.satoshis;
                if (amountToTake > satoshis + 5000)
                    break;
            }

            if (takeTillIndex >= 1) {
                var inputs = utxoData.splice(0, utxoMergeCount);
                var wif = getNewPrivKey();
                var changeWif = getNewPrivKey();

                var tx = createTransaction(inputs, changeWif, [wif], satoshis);
                broadcast(tx.hex);

                resultUtxo = tx.utxo.splice(0, 1)[0];
                utxoData = utxoData.concat(tx.utxo);
            }

            return utxoData;
        })
        return resultUtxo;
    }

    return { addCoinbaseUtxos, reset, createTransactions, getFunds }
}

module.exports = FakeTxHandler;