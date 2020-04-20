var fakeNet = require("./index");
var fs = require("fs");

const express = require('express');

const app = express();
app.use(express.json());

const port = 3000;


function wrap(app, realMethod, callType, path, handler) {
    var wrappedHandler = async (req, res) => {
        var logLineStart = `${callType} ${path}`;
        var space = '.'.repeat(Math.max(4, 30-logLineStart.length));
        console.log(`${logLineStart} ${space} body: ${JSON.stringify(req.body)}`)
        try { await handler(req,res); }
        catch (error) { res.status(500).send(error+""); }
    };
    return realMethod.call(app, path, wrappedHandler);
}

var _get = (path,handler) => wrap(app, app.get, "GET", path, handler);
var _post = (path,handler) => wrap(app, app.post, "POST", path, handler);


(async function () {
    var _fakenet = null;

    _get('/status', async (req, res) => {
        var configured = !!_fakenet;
        res.send({
            configured: configured,
            setupStatus: configured? await _fakenet.checkSetupStatus() : null,
            isRunning: configured && await _fakenet.isRunning()
        })
    })
    _get('/info', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        res.send(await _fakenet.getInfo());
    })
    _post('/configure', async (req, res) => {
        if(_fakenet)
            return res.status(400).send("FakeNet already configured")
        _fakenet = fakeNet(req.body.params[0] || {});
        res.send("done")
    })
    _post('/setup', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        var status = await _fakenet.checkSetupStatus();
        if(!status.called)
            await _fakenet.setup();
        res.send("done")
    })
    _post('/start', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        if(! await _fakenet.isRunning())
            await _fakenet.start();
        res.send("done")
    })
    _post('/stop', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        if(await _fakenet.isRunning())
            await _fakenet.stop();
        res.send("done")
    })
    _post('/getFunds', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        var setupStatus = await _fakenet.checkSetupStatus()
        if(!setupStatus.done)
            return res.status(400).send("FakeNet Setup not done")
        var amount = parseInt(req.body.params[0]);
        res.send(await _fakenet.getFunds(amount));
    })
    _post('/execute', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        var setupStatus = await _fakenet.checkSetupStatus()
        if(!setupStatus.done)
            return res.status(400).send("FakeNet Setup not done")
        var command = req.body.params[0].toString();
        res.send(await _fakenet.executeBitcoinCliCommand(command));
    })
    _post('/createTransactions', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        var setupStatus = await _fakenet.checkSetupStatus()
        if(!setupStatus.done)
            return res.status(400).send("FakeNet Setup not done")
        var count = parseInt(req.body.params[0]);
        res.send(await _fakenet.createTransactions(count));
    })
    _post('/mine', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        var setupStatus = await _fakenet.checkSetupStatus()
        if(!setupStatus.done)
            return res.status(400).send("FakeNet Setup not done")
        var count = parseInt(req.body.params[0]);
        res.send(await _fakenet.mineBlocks(count));
    })
    _post('/broadcast', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        var setupStatus = await _fakenet.checkSetupStatus()
        if(!setupStatus.done)
            return res.status(400).send("FakeNet Setup not done")
        var hexTx = req.body.params[0].toString();
        res.send(await _fakenet.broadcast(hexTx));
    })

    var defaultOptions = JSON.stringify(fakeNet.defaultOptions, null, 2);
    // var page = fs.readFileSync("./serviceHome.html").toString()
    //     .replace("<<<defaultOptions>>>", defaultOptions)

    _get('/', (req, res) => res.send(
        fs.readFileSync("./serviceHome.html").toString()
            .replace("<<<defaultOptions>>>", defaultOptions)
    ));

    var server = app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`))
})()