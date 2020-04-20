var fakeNet = require("./index");
var fs = require("fs");

const express = require('express');

const app = express();
app.use(express.json());

const port = 3000;

(async function () {
    var _fakenet = null;

    app.get('/status', async (req, res) => {
        var configured = _fakenet != false;
        res.send({
            configured: configured,
            isRunning: configured && await _fakenet.isRunning()
        })
    })
    app.get('/info', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        res.send(await _fakenet.getInfo());
    })
    app.get('/setupStatus', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        res.send(await _fakenet.checkSetupStatus());
    })
    app.post('/configure', (req, res) => {
        if(_fakenet)
            return res.status(400).send("FakeNet already configured")
        _fakenet = fakeNet(req.body.params[0] || {});
        res.send("done")
    })
    app.post('/setup', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        var status = await _fakenet.checkSetupStatus();
        if(!status.called)
            await _fakenet.setup();
        res.send("done")
    })
    app.post('/start', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        if(! await _fakenet.isRunning())
            await _fakenet.start();
        res.send("done")
    })
    app.post('/stop', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        if(await _fakenet.isRunning())
            await _fakenet.stop();
        res.send("done")
    })
    app.post('/delete', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("No present FakeNet to delete")
        if(await _fakenet.isRunning())
            await _fakenet.stop();
        _fakenet = null;
        res.send("done")
    })
    app.post('/getFunds', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        if(! await _fakenet.isRunning(0))
            return res.status(400).send("FakeNet not running")
        var amount = parseInt(req.body.params[0]);
        res.send(await _fakenet.getFunds(amount));
    })
    app.post('/execute', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        if(! await _fakenet.isRunning(0))
            return res.status(400).send("FakeNet not running")
        var command = req.body.params[0].toString();
        res.send(await _fakenet.executeBitcoinCliCommand(command));
    })
    app.post('/createTransactions', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        if(! await _fakenet.isRunning(0))
            return res.status(400).send("FakeNet not running")
        var count = parseInt(req.body.params[0]);
        res.send(await _fakenet.createTransactions(count));
    })
    app.post('/mine', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        if(! await _fakenet.isRunning(0))
            return res.status(400).send("FakeNet not running")
        var count = parseInt(req.body.params[0]);
        res.send(await _fakenet.mineBlocks(count));
    })
    app.post('/broadcast', async (req, res) => {
        if(!_fakenet)
            return res.status(400).send("FakeNet not configured")
        if(! await _fakenet.isRunning(0))
            return res.status(400).send("FakeNet not running")
        var hexTx = req.body.params[0].toString();
        res.send(await _fakenet.broadcast(hexTx));
    })

    var defaultOptions = JSON.stringify(fakeNet.defaultOptions, null, 2);
    // var page = fs.readFileSync("./serviceHome.html").toString()
    //     .replace("<<<defaultOptions>>>", defaultOptions)

    app.get('/', (req, res) => res.send(
        fs.readFileSync("./serviceHome.html").toString()
        .replace("<<<defaultOptions>>>", defaultOptions)
    ));

    var server = app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`))
})()