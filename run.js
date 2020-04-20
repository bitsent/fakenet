var fakeNet = require("./index");

(async function () {
    var fakenet = fakeNet({ });
    await fakenet.startFullyInContainer();
})()