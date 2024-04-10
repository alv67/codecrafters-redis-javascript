const net = require("net");

const memory = {}; // internal memory
let listeningPort = 0;

const portIndex = process.argv.indexOf('--port');
if (portIndex == -1 || !process.argv[portIndex +1]) {
    listeningPort = 6379; 
} else {
    listeningPort = Number(process.argv[portIndex +1]);
}
//


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
    // Command is forced to be UPPERCASE
    return ret;    
}

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
                    response = bulkString('role:master');
                }
                break;

            default:
                response = simpleError(`Command ${cmd} not managed`);
        }

        connection.write(response);
    })
});

server.listen(listeningPort, "127.0.0.1");