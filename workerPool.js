var Lock = require("lock-taskqueue");

function Pool(workerCount) {
    var workers = [];
    for (let i = 0; i < workerCount; i++)
        workers.push(Lock());
    
    return (async function (task) {
        var i = Math.floor(Math.random() * workers.length);
        var worker = workers[i];
        
        console.log(`Worker ${i} working on (${task + ""})`)

        return await worker(task);
    })
}

module.exports = Pool