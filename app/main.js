const net = require("net");

const memory = {};

function cmdlineParser(data) {
    let par = "";
    let ret = [];

    let splitData = data.toString().split("\r\n");
    // --- debug ---
    console.log(`\ncmdPArser: ${splitData}`);

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
                    // first string is a command -> force to UPPERCASE
                    if (i === 0) s = s.toUpperCase();
                    ret.push(s);
                }
                break;
            default:
                console.log("Warning: Unmanaged type");
                return;
        }
    }
    // Command is forced to be UPPERCASE
    ret[0] 
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
        switch (cmdline[0]) {
            case 'COMMAND':
            case 'PING':
                response = simpleString('PONG');
                break;
            case 'ECHO':
                if (cmdline.length < 2) {
                    response = simpleError('Syntax : ECHO message');
                }
                response = bulkString(cmdline[1]);
                break;
            case 'SET':
                if (cmdline.length < 3) {
                    response = simpleError('Syntax: SET key value');
                }
                // store parameter
                memory[cmdline[1]] = cmdline[2];
                response = simpleString('OK');
                break;
            case 'GET':
                if (cmdline.length < 2) {
                    response = simpleError('Syntax: GET key');
                }
                if (cmdline[1] in  memory) {
                    response = bulkString(memory[cmdline[1]]);
                } else {
                    response = bulkString(null);
                }
                break;
            default:
                response = simpleError(`Command ${cmsline[0]} not managed`);
        }

        connection.write(response);
    })
});

server.listen(6379, "127.0.0.1");