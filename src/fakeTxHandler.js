var fs = require("fs");
var bsv = require("bsv");
var Lock = require("lock-taskqueue");
var path = require("path");

SATS_IN_B = 100000000;

default_utxoFile = path.join(__dirname,  "utxo.json");
default_utxoCoinbaseFile = path.join(__dirname,  "utxo_coinbase.json");
default_chances = {
    plusOneInputChance: 0.33,
    plusOneOutputChance: 0.40,
    opReturnOutputChance: 0.10,
    forgetSmallerHalfUtxosChance: 0.01,
}
default_settings = {
    autoForgetUTXOLowerThan: (0.1 * SATS_IN_B) | 0,
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
        await lock(async () => {
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
        return await usingJsonFile(func, utxoFile, utxoLock);
    }

    async function usingUtxoCoinbaseFile(func) {
        return await usingJsonFile(func, utxoCoinbaseFile, utxoCoinbaseLock);
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
        perOutputAmount = parseInt(perOutputAmount || ((inAmount / outputWifArray.length) - 2000));

        if (inAmount < 5000)
            throw new Error("Inputs are too small");
        if (perOutputAmount < 2000)
            throw new Error("Outputs are too small");

        var tx = bsv.Transaction();
        for (let i = 0; i < inputs.length; i++)
            tx=tx.from(asInput(inputs[i]));

        for (let i = 0; i < outputWifArray.length; i++)
            tx=tx.to(wifToAddr(outputWifArray[i]), perOutputAmount);

        if (opReturn)
            tx=tx.addData(opReturn);

        var feeNeeded = (tx.toString().length / 2) + 500;
        var change = inAmount - (perOutputAmount * outputWifArray.length) - feeNeeded
        var sendChange = change > 1000

        if (change < 0)
            throw new Error("Not enough Funds");

        if (sendChange)
            tx=tx.to(wifToAddr(changeWif), change)

        for (let i = 0; i < inputs.length; i++)
            tx=tx.sign(inputs[i].privkey);

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
            var changeScript = tx.outputs[changeVout].script.toHex();
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

            utxoData = utxoData.sort((a, b) => a.satoshis - b.satoshis);

            var utxoForgetCount = 0;
            for (let i = 0; i < utxoData.length; i++)
                if (utxoData[i].satoshis < settings.autoForgetUTXOLowerThan)
                utxoForgetCount = i + 1
                else break;
    
            if (checkChance(chances.forgetSmallerHalfUtxosChance))
                utxoForgetCount = Math.max(utxoForgetCount, utxoData.length / 2 | 0)
    
            if (utxoForgetCount > 1) {
                var forgottenUtxos = utxoData.splice(0, utxoForgetCount);
                console.log(`Forgot ${forgottenUtxos.length} UTXOs...`);
            }
    
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

                try {
                    var tx = createTransaction(inputs, outputWifArray[0], outputWifArray, null, opReturn);
                    await broadcast(tx.hex);
                    transactions.push(tx.hex);
                    utxoData = utxoData.concat(tx.utxo);
                } catch (error) {
                    console.error("Broadcast Failed. Deleting problematic inputs.\n"
                        +"Error message was:\n" + error)
                }
            }

            return utxoData;
        })
        return transactions;
    }

    async function getFunds(satoshis) {
        resultUtxo = null;
        await usingUtxoFile(async (utxoData) => {
            if (utxoData.length == 0)
                return []; // no inputs

            utxoData = utxoData.sort((a, b) => a.satoshis - b.satoshis);
            var takeTillIndex = 0;
            var amountToTake = 0

            for (let i = 0; i < utxoData.length; i++) {
                takeTillIndex++;
                amountToTake += utxoData[i].satoshis;
                if (amountToTake > satoshis + 5000)
                    break;
            }

            if (!takeTillIndex || amountToTake < satoshis + 5000)
                throw new Error("Not enough funds");

            var inputs = utxoData.splice(0, takeTillIndex);
            var wif = getNewPrivKey();
            var changeWif = getNewPrivKey();

            var tx = createTransaction(inputs, changeWif, [wif], satoshis);
            await broadcast(tx.hex);
            resultUtxo = tx.utxo.splice(0, 1)[0];
            utxoData = utxoData.concat(tx.utxo);

            return utxoData;
        })
        return resultUtxo;
    }

    return { addCoinbaseUtxos, reset, createTransactions, getFunds }
}

module.exports = FakeTxHandler;
