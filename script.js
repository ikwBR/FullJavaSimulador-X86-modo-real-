// script.js (VERSÃO FINAL: FORMATAÇÃO IGUAL AO EXEMPLO DO PROFESSOR)

// --- CONFIGURAÇÃO ---
const AUTO_RUN_DELAY = 500; 
let autoRunInterval = null;

// --- ESTADO DA MÁQUINA ---
let machineState = {
    AX: 0, BX: 0, CX: 0, DX: 0,
    CS: 0x1000, SS: 0x2000, DS: 0x3000, ES: 0x4000,
    IP: 0x0100, SP: 0xFFFE, BP: 0, DI: 0, SI: 0x0010,
    FLAGS: 0x0002,
    memory: {}, 
    instructions: [],
    currentInstructionIndex: 0,
    busStep: 1,
    logs: "",     
    calcLog: "",
    busWidth: 8 // Padrão, atualizado dinamicamente
};

// ============================================================================
//  CORE DO SIMULADOR
// ============================================================================

const SimulatorCore = {
    
    hexToInt: function(val) {
        if (typeof val === 'string') {
            val = val.toUpperCase().replace(/H/g, '').replace(/\[/g, '').replace(/\]/g, '').trim();
            if (val === '') return 0;
            return parseInt(val, 16) || 0;
        }
        return val & 0xFFFF;
    },

    padHex: function(num, len = 4) {
        return (num >>> 0).toString(16).toUpperCase().padStart(len, '0');
    },

    physAddr: function(seg, off) {
        return (seg * 16) + off;
    },

    updateFlags: function(result) {
        const res16 = result & 0xFFFF;
        if (res16 === 0) machineState.FLAGS |= (1 << 6);
        else machineState.FLAGS &= ~(1 << 6);
        if (res16 & 0x8000) machineState.FLAGS |= (1 << 7);
        else machineState.FLAGS &= ~(1 << 7);
        machineState.FLAGS |= 0x0002;
    },

    writeMem: function(physAddr, byteVal, desc) {
        const addrHex = this.padHex(physAddr, 5);
        machineState.memory[addrHex] = { val: byteVal & 0xFF, desc: desc };
    },

    readMem: function(physAddr) {
        const addrHex = this.padHex(physAddr, 5);
        const data = machineState.memory[addrHex];
        return data ? data.val : 0;
    },

    // --- MONTADOR ---
    assemble: function(op, dest, src, currentIP) {
        op = op.toUpperCase();
        // Validações de Registradores para distinguir Imediatos
        const regs = ['AX','BX','CX','DX','SI','DI','BP','SP','CS','DS','SS','ES'];

        // 1. MOV AX, IMM (3 Bytes)
        if (op === 'MOV' && dest === 'AX') {
            if (!regs.includes(src) && src !== "") {
                const val = this.hexToInt(src);
                return [0xB8, val & 0xFF, val >> 8];
            }
        }
        // 2. ADD BX, AX (2 Bytes)
        if (op === 'ADD' && dest === 'BX' && src === 'AX') return [0x01, 0xD8];
        // 3. MOV [SI], AX (2 Bytes)
        if (op === 'MOV' && dest === '[SI]' && src === 'AX') return [0x89, 0x04];
        // 4. JMP (3 Bytes)
        if (op === 'JMP') {
            const target = this.hexToInt(dest);
            const nextIP = (currentIP + 3) & 0xFFFF;
            let offset = (target - nextIP) & 0xFFFF;
            return [0xE9, offset & 0xFF, offset >> 8];
        }
        // 5. MOV MEM, IMM (6 Bytes)
        if (op === 'MOV' && dest.startsWith('[') && src !== "" && !regs.includes(src)) {
            const d = this.hexToInt(dest);
            const s = this.hexToInt(src);
            return [0xC7, 0x06, d & 0xFF, d >> 8, s & 0xFF, s >> 8];
        }
        // Fallbacks
        const mapOp = {'MOV':0x89, 'ADD':0x01, 'SUB':0x29, 'CMP':0x39, 'AND':0x21, 'OR':0x09, 'XOR':0x31, 'PUSH':0x50, 'POP':0x58};
        const base = mapOp[op] || 0x90;
        if (['INC', 'DEC', 'PUSH', 'POP'].includes(op)) return [base];
        return [base, 0xC0];
    },

    // --- FETCH (Formatado igual ao professor) ---
    fetch: function(op, dest, src) {
        let log = "; --- CICLO DE BUSCA (FETCH) ---\n";
        const cs = machineState.CS;
        const ip = machineState.IP;
        const bytes = this.assemble(op, dest, src, ip);
        const size = bytes.length;

        if (machineState.busWidth === 16) {
            // MODO 16 BITS
            for (let i = 0; i < size; i += 2) {
                const phys = this.physAddr(cs, (ip + i) & 0xFFFF);
                const addrHex = this.padHex(phys, 5);
                const low = bytes[i];
                const high = (i + 1 < size) ? bytes[i+1] : null;

                // Descrição para memória
                let descL = this.getDesc(op, size, i);
                this.writeMem(phys, low, descL);
                
                let dataBusStr = "";
                if (high !== null) {
                    let descH = this.getDesc(op, size, i+1);
                    this.writeMem(phys+1, high, descH);
                    dataBusStr = this.padHex(high, 2) + this.padHex(low, 2);
                } else {
                    dataBusStr = this.padHex(low, 2);
                }

                // --- FORMATAÇÃO NOVA ---
                // Passo X (MP para MEM): ENDERECO (BUS END)
                log += `Passo ${machineState.busStep++} (MP para MEM): ${addrHex} (BUS END)\n`;
                // Passo Y (MEM para MP): DADO (BUS DADOS)
                log += `Passo ${machineState.busStep++} (MEM para MP): ${dataBusStr}H (BUS DADOS)\n`;
            }
        } else {
            // MODO 8 BITS
            bytes.forEach((byteVal, i) => {
                const phys = this.physAddr(cs, (ip + i) & 0xFFFF);
                const desc = this.getDesc(op, size, i);
                
                log += `Passo ${machineState.busStep++} (MP para MEM): ${this.padHex(phys, 5)} (BUS END)\n`;
                log += `Passo ${machineState.busStep++} (MEM para MP): ${this.padHex(byteVal, 2)}H (BUS DADOS)\n`;
                
                this.writeMem(phys, byteVal, desc);
            });
        }

        const newIP = (ip + size) & 0xFFFF;
        machineState.calcLog = `Modo: ${machineState.busWidth}-bits\nCS:IP = ${this.padHex(cs)}:${this.padHex(ip)}H\nNovo IP: ${this.padHex(newIP)}H`;
        machineState.IP = newIP;
        return log;
    },

    getDesc: function(op, size, i) {
        if (op === 'MOV' && size === 6) return ["Opcode", "ModRM", "Disp L", "Disp H", "Imm L", "Imm H"][i];
        if (op === 'MOV' && size === 3) return ["Opcode", "Imm L", "Imm H"][i];
        if (op === 'ADD' && size === 2) return ["Opcode", "ModRM"][i];
        if (op === 'JMP') return ["Opcode", "Disp L", "Disp H"][i];
        if (i===0) return "Opcode";
        return "Byte";
    },

    // --- EXECUTE (Formatado igual ao professor) ---
    execute: function(op, dest, src) {
        let log = `; --- CICLO DE EXECUÇÃO (${op}) ---\n`;
        op = op.toUpperCase();
        let valSrc = machineState[src] !== undefined ? machineState[src] : (src ? this.hexToInt(src) : 0);

        if (op === 'MOV' && dest.startsWith('[')) {
            const ds = machineState.DS;
            let off = this.hexToInt(dest);
            if (dest === '[SI]') off = machineState.SI;
            if (dest === '[DI]') off = machineState.DI;
            const phys = this.physAddr(ds, off);
            
            const low = valSrc & 0xFF;
            const high = (valSrc >> 8) & 0xFF;

            if (machineState.busWidth === 16) {
                // Escrita 16 Bits
                log += `Passo ${machineState.busStep++} (MP para MEM): ${this.padHex(phys, 5)} (BUS END)\n`;
                // MP envia dado (Escrita) -> MP para MEM
                log += `Passo ${machineState.busStep++} (MP para MEM): ${this.padHex(valSrc, 4)}H (BUS DADOS)\n`;
            } else {
                // Escrita 8 Bits
                log += `Passo ${machineState.busStep++} (MP para MEM): ${this.padHex(phys, 5)} (BUS END)\n`;
                log += `Passo ${machineState.busStep++} (MP para MEM): ${this.padHex(low, 2)}H (BUS DADOS)\n`;
                
                log += `Passo ${machineState.busStep++} (MP para MEM): ${this.padHex(phys+1, 5)} (BUS END)\n`;
                log += `Passo ${machineState.busStep++} (MP para MEM): ${this.padHex(high, 2)}H (BUS DADOS)\n`;
            }
            this.writeMem(phys, low, "Escrita Low");
            this.writeMem(phys+1, high, "Escrita High");
        } 
        else if (machineState[dest] !== undefined) {
            machineState[dest] = valSrc;
            log += `; Interno: ${dest} = ${this.padHex(valSrc)}H\n`;
        } 
        else if (op === 'ADD') {
            let res = machineState[dest] + valSrc;
            machineState[dest] = res & 0xFFFF;
            this.updateFlags(res);
            log += `; ALU: ${dest} = ${this.padHex(machineState[dest])}H\n`;
        }
        else if (op === 'JMP') {
            machineState.IP = this.hexToInt(dest);
            log += `; JMP: IP = ${this.padHex(machineState.IP)}H\n`;
        }
        return log;
    },

    runStep: function(line) {
        const select = document.getElementById('bus-mode');
        if (select) machineState.busWidth = parseInt(select.value, 10);

        const cleanLine = line.split(';')[0].trim().toUpperCase();
        const match = cleanLine.match(/(\w+)(?:\s+([^,]+)(?:,\s*(.+))?)?$/);
        if (!match) return { error: "Erro Sintaxe" };
        
        const op = match[1];
        const dest = match[2] ? match[2].trim() : "";
        const src = match[3] ? match[3].trim() : "";

        const logFetch = this.fetch(op, dest, src);
        const logExec = this.execute(op, dest, src);
        machineState.logs = logFetch + logExec;
        return { success: true };
    }
};

// --- UI ---
function padHexUI(num) { return (num & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); }

function highlightChanges(oldState, newState) {
    const keys = ['AX','BX','CX','DX','CS','SS','DS','ES','IP','SP','BP','DI','SI','FLAGS'];
    keys.forEach(key => {
        if (oldState[key] !== newState[key]) {
            const id = key === 'FLAGS' ? 'reg-flag-value' : `reg-${key.toLowerCase()}`;
            const el = document.getElementById(id);
            if (el) {
                el.classList.remove('blink');
                void el.offsetWidth; 
                el.classList.add('blink');
            }
        }
    });
}

function updateUI() {
    ['ax','bx','cx','dx','cs','ss','ds','es','ip','sp','bp','di','si'].forEach(r => {
        document.getElementById(`reg-${r}`).textContent = padHexUI(machineState[r.toUpperCase()]) + 'H';
    });
    document.getElementById('reg-flag-value').textContent = padHexUI(machineState.FLAGS) + 'H';

    const memDiv = document.getElementById('memory-view');
    const sortedAddr = Object.keys(machineState.memory).sort((a,b) => parseInt(a,16) - parseInt(b,16));
    let html = `<table class="memory-table"><thead><tr><th>Endereço</th><th>Valor</th><th>Significado</th></tr></thead><tbody>`;
    sortedAddr.forEach(addr => {
        const m = machineState.memory[addr];
        html += `<tr><td><b>${addr}H</b></td><td class="mem-val">${SimulatorCore.padHex(m.val, 2)}H</td><td class="mem-desc">${m.desc}</td></tr>`;
    });
    html += `</tbody></table>`;
    memDiv.innerHTML = html;
}

function loadCode() {
    const raw = document.getElementById('assembly-code').value;
    machineState.instructions = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith(';'));
    if (machineState.instructions.length === 0) return false;
    machineState.currentInstructionIndex = 0;
    document.getElementById('status-message').textContent = `Carregado.`;
    return true;
}

async function simulateExecution(action) {
    if (action === 'init') {
        stopAutoRun();
        simulateExecution('reset');
        if(loadCode()) updateUI();
        return;
    }
    if (action === 'reset') {
        stopAutoRun();
        const select = document.getElementById('bus-mode');
        const currentMode = select ? parseInt(select.value, 10) : 8;
        machineState = {
            AX: 0, BX: 0, CX: 0, DX: 0, CS: 0x1000, SS: 0x2000, DS: 0x3000, ES: 0x4000,
            IP: 0x0100, SP: 0xFFFE, BP: 0, DI: 0, SI: 0x0010, FLAGS: 0x0002,
            memory: {}, instructions: [], currentInstructionIndex: 0, busStep: 1,
            logs: "", calcLog: "", busWidth: currentMode
        };
        document.getElementById('fluxo-output').textContent = "Simulador Resetado.";
        document.getElementById('address-calculation-output').textContent = "";
        updateUI();
        return;
    }
    if (machineState.instructions.length === 0 || machineState.currentInstructionIndex >= machineState.instructions.length) {
        stopAutoRun(); return;
    }

    const line = machineState.instructions[machineState.currentInstructionIndex];
    const oldState = { ...machineState };
    const result = SimulatorCore.runStep(line);

    if (result.error) {
        document.getElementById('status-message').textContent = `Erro: ${result.error}`;
        stopAutoRun();
        return;
    }

    highlightChanges(oldState, machineState);
    updateUI();
    
    const flux = document.getElementById('fluxo-output');
    flux.textContent += `\n\n[${padHexUI(machineState.currentInstructionIndex)}] ${line}\n${machineState.logs}`;
    flux.scrollTop = flux.scrollHeight;
    document.getElementById('address-calculation-output').textContent = machineState.calcLog;
    
    machineState.currentInstructionIndex++;
    if (machineState.currentInstructionIndex >= machineState.instructions.length) stopAutoRun();
}

function toggleAutoRun() {
    if (autoRunInterval) stopAutoRun();
    else {
        const btn = document.getElementById('btn-autorun');
        btn.textContent = "Parar";
        btn.style.backgroundColor = "#da3633";
        simulateExecution('step');
        autoRunInterval = setInterval(() => simulateExecution('step'), AUTO_RUN_DELAY);
    }
}

function stopAutoRun() {
    if (autoRunInterval) { clearInterval(autoRunInterval); autoRunInterval = null; }
    const btn = document.getElementById('btn-autorun');
    if (btn) { btn.textContent = "Executar Tudo"; btn.style.backgroundColor = ""; }
}

function changeBusMode() {
    document.getElementById('status-message').textContent = "Modo alterado. Resete para aplicar limpo.";
}

document.addEventListener('DOMContentLoaded', updateUI);
