const fetch = require('node-fetch');

async function sendRequest(host, port, method, path, body = "") {
    var url = 'http://' + host + ':' + port + path;
    var res = await fetch(url, {
        method: method,
        body: body.length? body : undefined,
        headers: body.length? { 'Content-Type': 'application/json' } : undefined,
    })

    if (res.status >= 400)
        throw new Error("Bad Status (" + res.status + ") from " + url + "\n" + JSON.stringify(res))

    if (res.headers.get("content-type").startsWith("application/json"))
        return await res.json();
    else
        return await res.text();
}

async function broadcast(host, port, txHex) {
    var response = await sendRequest(host, port, "POST", '/1/t/push', txHex);
    return response;
}
async function mine(host, port, count, apiPassword) {
    var path = `/1/r/generate?count=${count}&key=${apiPassword}`;
    var response = await sendRequest(host, port, "POST", path);
    return response;
}

module.exports = {
    broadcast, mine
}