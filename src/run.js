var fakeNet = require("./fakeNet");

(async function () {
    var fakenet = fakeNet({ });
    await fakenet.startFullyInContainer();
})()