var fakeNet = require("./index");

(async function () {
    var fakenet = fakeNet({
        tryAttachToLastContainer : true
    });
    await fakenet.start();

    var utxo = await fakenet.getFunds(10000000);
    console.log(utxo);
})()