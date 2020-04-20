var FakeNet = require("./src/fakeNet")
var service = require("./src/service")

FakeNet.service = service;

module.exports = FakeNet