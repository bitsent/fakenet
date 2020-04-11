var FakeNet = require("./FakeNet")

// CODE FOR MANUAL TEST - // TODO: DELETE

    var fakenet = new FakeNet({
        blocktime : 2500,
        txCount : 20,
            existingContainerId : "f0abce39dc15"
    });

    fakenet.start();

// CODE FOR MANUAL TEST - // TODO: DELETE

module.exports = FakeNet