var exec = require('child_process').exec;

var myExec = (command, log=false) => {
    return new Promise((resolve,reject)=> {
        console.log(">> RUNNING : " + command);
        exec(command, (err, stdout, stderr) => {
            var toLog = [stdout, stderr].filter(i=>i).join("\n")
            if(log && toLog) console.log(toLog);
            if(err) reject(err);
            resolve({stdout, stderr});
        })
    });
};

module.exports = myExec;