var FakeNet = require("./FakeNet")

// CODE FOR MANUAL TEST - // TODO: DELETE

    var fakenet = new FakeNet({
        blocktime : 25000,
        txCount : 20,
        tryAttachToLastContainer : true
    });

    fakenet.start();

// CODE FOR MANUAL TEST - // TODO: DELETE

module.exports = FakeNet