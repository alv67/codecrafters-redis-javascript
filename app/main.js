const net = require("net");

const memory = {}; // internal memory
let globalConfig = {
    PORT: 0,
    MASTER_HOST: '',
    MASTER_PORT: 0
}
// let globalConfig.PORT = 0;
// let globalConfig.MASTER_HOST = '';
// let globalConfig.MASTER_PORT = 0;
let replicationInfos = {
    "master_replid": "8371b4fb1155b71f4a04d3e1bc3e18c4a990aeeb",
    "master_repl_offset": 0
}

// -----------------------------
// Redis serialization functions
// -----------------------------

function simpleString(s) {
    return `+${s}\r\n`;
}

function simpleError(s) {
    return `-${s}\r\n`;
}

function bulkString(s) {
    if (s === null) {
        return '\$-1\r\n';
    } else {
        return `\$${s.length}\r\n${s}\r\n`;
    }
}

function stringArray(cmd) {
    const args = [...arguments];
    console.log(`stringArray: ${args}`)
    let ret = "";
    ret += `\*${args.length}\r\n`
    for (const arg of args) {
        ret += bulkString(arg)
    }
    return ret;
}

// ----------------------------------
// Redis command line deserialization
// ----------------------------------
function cmdlineParser(data) {
    let par = "";
    let ret = [];
    
    let splitData = data.toString().split("\r\n").slice(0,-1);
    // --- debug ---
    console.log(`\ncmdParser: ${splitData}`);
    
    par = splitData.shift()
    let num = 1;
    if (par[0] !== "*") {
        splitData.unshift(par)
    } else {
        // --- debug ---
        num = Number(par.slice(1));
    }
    
    for (let i = 0; i < num; i++) {
        par = splitData.shift();
        if (par === undefined) {
            console.log("Error: undefined parameter");
            return;
        }
        switch (par[0]) {
            // data type 
            case '+': // simple string
                ret.push(par.slice(1));
                break;
            case '-': // simple error
            case ':': // integer
                console.log("Warning: Unmanaged type");
                return;
            case '$': // Bulk string
                if (par.length < 2) {
                    console.log("Error: undefined parameter");
                    return;
                }
                let len = Number(par.slice(1));
                // check for "null" string
                if (len === -1) {
                    ret.push(null);
                    break;
                } else {
                    // next par contain string (lenght len)
                    let s = splitData.shift();
                    if (s.length !== len) {
                        console.log("Error: wrong string length");
                        return;
                    }
                    ret.push(s);
                }
                break;
            default:
                console.log("Warning: Unmanaged type");
                return;
        }
    }
    return ret;
    
}

function replicaConnection() {
    var stage = 'PING' // then 'REPLCONF1', 'REPLCONF2', 'PSYNC'

    // Connect to the master server
    const replicaSocket = net.createConnection({
        host: globalConfig.MASTER_HOST,
        port: globalConfig.MASTER_PORT
    });

    // first connection
    replicaSocket.on('connect', () => {
        console.log(`Connected to master at ${globalConfig.MASTER_HOST}:${globalConfig.MASTER_PORT}`);
        const command = stringArray('ping');
        replicaSocket.write(command);
    });

    replicaSocket.on('data', (data) => {
        const cmdline = cmdlineParser(data);
        console.log(`replica response: ${cmdline}`);

        // ++++ RESPONSE PARSER +++++
        let cmd = cmdline.shift().toUpperCase(); 

        switch (stage) {
            case 'PING':
                if (cmd === 'PONG') {
                    const command = stringArray('REPLCONF', 'listening-port', `${globalConfig.PORT}`);
                    replicaSocket.write(command);
                    stage = 'REPLCONF1';
                }
                break;
            case 'REPLCONF1':
                if (cmd === 'OK') {
                    const command = stringArray('REPLCONF', 'capa', 'eof', 'capa', 'psync2');
                    replicaSocket.write(command);
                    stage = 'REPLCONF2';
                }
                break;
            case 'REPLCONF2':
                if (cmd === 'OK') {
                    const command = stringArray('PSYNC', '?', '-1');
                    replicaSocket.write(command);
                    stage = 'PSYNC';
                }
                break;
            case 'PSYNC':
                if (cmd === 'FULLSRESYNC <REPL_ID> 0') {

                }
                break;
        }

    }) 
    // Handle errors
    replicaSocket.on('error', (err) => {
        console.error('Error connecting to the master!!');
    });
}

  /////////////////////
 //    MAIN CODE    //
/////////////////////

const portIndex = process.argv.indexOf('--port');
if (portIndex == -1 || !process.argv[portIndex +1]) {
    globalConfig.PORT = 6379; 
} else {
    globalConfig.PORT = Number(process.argv[portIndex +1]);
}

const replicaofIndex = process.argv.indexOf('--replicaof');
if (replicaofIndex == -1 || !process.argv[replicaofIndex +1] || !process.argv[replicaofIndex +2]) {
    replicationInfos['role'] = 'master';
} else {
    replicationInfos['role'] = 'slave'
    // --- debug ---
    console.log('--replicaof');
    globalConfig.MASTER_HOST = process.argv[replicaofIndex +1];
    globalConfig.MASTER_PORT = Number(process.argv[replicaofIndex +2]);
}

if (replicationInfos.role === 'slave') replicaConnection();

const server = net.createServer((connection) => {
    // Handle multiple connection
    connection.on('data', (data) => {
        let response = '';
        const cmdline = cmdlineParser(data);
        // --- debug ---
        console.log(`Command: ${cmdline}`);

        // ++++ COMMAND PARSER +++++
        let cmd = cmdline.shift().toUpperCase(); 
        switch (cmd) {
            case 'COMMAND':
            case 'PING':
                response = simpleString('PONG');
                break;
            case 'ECHO':
                if (cmdline.length < 1) {
                    response = simpleError('Syntax : ECHO message');
                }
                response = bulkString(cmdline.shift());
                break;
            case 'SET':
                if (cmdline.length < 2) {
                    response = simpleError('Syntax: SET key value [PX milliseconds]');
                    break;
                }
                var key = cmdline.shift();
                var value = cmdline.shift();
                var pxtime = 0;
                // check for additional parameters
                var args = cmdline.length; 
                while (cmdline.length > 0) {
                    let p = cmdline.shift().toUpperCase();
                    switch(p) {
                        case 'PX':
                            if (cmdline.length === 0) {
                                response = simpleError('Syntax: SET key value [PX milliseconds]');
                                break;
                            }
                            pxtime = Number(cmdline.shift())
                            break;
                    }
                }                
                // store parameter
                memory[key] = value;
                if (pxtime) setTimeout(() => {delete memory[key]}, pxtime);
                response = simpleString('OK');
                break;
            case 'GET':
                if (cmdline.length < 1) {
                    response = simpleError('Syntax: GET key');
                }
                var key = cmdline.shift();
                if (key in memory) {
                    response = bulkString(memory[key]);
                } else {
                    response = bulkString(null);
                }
                break;
            case 'INFO':
                if (cmdline.length < 1) {
                    response = simpleError('Syntax: INFO [section]');
                }
                var section = cmdline.shift();
                if (section == 'replication') {
                    let str = ''
                    for ([key, value] of Object.entries(replicationInfos)) {
                        str += `${key}:${value}\r\n`; 
                    }
                    str.slice(0,-2); // remove last two \r\n
                    response = bulkString(str);
                }
                break;
            case 'REPLCONF':
                if (cmdline.length < 1) {
                    response = simpleError('Syntax: REPLCONF [section]');
                }
                response = simpleString('OK');
                break;

            case 'PSYNC':
                if (cmdline.length < 1) {
                    response = simpleError('Syntax: PSYNC [section]');
                }
                response = simpleString(`FULLRESYNC ${replicationInfos.master_replid} 0`);
                break;

            default:
                response = simpleError(`Command ${cmd} not managed`);
        }

        connection.write(response);
    })
});

server.listen(globalConfig.PORT, "127.0.0.1");