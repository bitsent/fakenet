
function awaitableTimeout(func, timeout){
    return new Promise(async (resolve, reject) => {
        setTimeout(async ()=>{
            try { await func() }
            catch (error) { reject(error); }
            resolve();
        }, timeout);
    })
}

module.exports = awaitableTimeout;