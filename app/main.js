const net = require("net");

const memory = {}; // internal memory
let listeningPort = 0;
let masterHost = '';
let masterPort = 0;
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
    if (par[0] !== "*") {
        // --- debug ---
        console.log("Error: Command must be a RESP array");
        return;
    }
    let num = Number(par.slice(1));
    
    for (let i = 0; i < num; i++) {
        par = splitData.shift();
        if (par === undefined) {
            console.log("Error: undefined parameter");
            return;
        }
        switch (par[0]) {
            // data type 
            case '+': // simple string
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

  /////////////////////
 //    MAIN CODE    //
/////////////////////

const portIndex = process.argv.indexOf('--port');
if (portIndex == -1 || !process.argv[portIndex +1]) {
    listeningPort = 6379; 
} else {
    listeningPort = Number(process.argv[portIndex +1]);
}

const replicaofIndex = process.argv.indexOf('--replicaof');
if (replicaofIndex == -1 || !process.argv[replicaofIndex +1] || !process.argv[replicaofIndex +2]) {
    replicationInfos['role'] = 'master';
} else {
    replicationInfos['role'] = 'slave'
    // --- debug ---
    console.log('--replicaof');
    masterHost = process.argv[replicaofIndex +1];
    masterPort = Number(process.argv[replicaofIndex +2]);
}

if (replicationInfos.role === 'slave') {
    // --- debug ---
    // Connect to the master server
    const replicaSocket = net.createConnection({
        host: masterHost,
        port: masterPort
    }, () => {
        console.log(`Connected to master at ${masterHost}:${masterPort}`);
        const command = stringArray('ping');
        replicaSocket.write(command);
    });
    
    // Handle errors
    replicaSocket.on('error', (err) => {
        console.error('Error connecting to the master!!');
    });
}


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

            default:
                response = simpleError(`Command ${cmd} not managed`);
        }

        connection.write(response);
    })
});

server.listen(listeningPort, "127.0.0.1");