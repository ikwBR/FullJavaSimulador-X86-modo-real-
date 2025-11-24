// script.js (VERSÃO FINAL: FLUXO VISUAL IGUAL AO PROFESSOR + LÓGICA REALISTA)

const AUTO_RUN_DELAY = 500; 
let autoRunInterval = null;

// --- ESTADO INICIAL ---
let machineState = {
    AX: 0, BX: 0, CX: 0, DX: 0,
    CS: 0x4000, SS: 0x5000, DS: 0x6000, ES: 0x7000, // Valores Personalizados
    IP: 0xAE00, SP: 0xFFFE, BP: 0, DI: 0, SI: 0x0010,
    FLAGS: 0x0002,
    memory: {}, 
    instructions: [],
    currentInstructionIndex: 0,
    busStep: 1,
    logs: "",     
    calcLog: "",      
    calcHistory: [],  
    busWidth: 8 
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
    physAddr: function(seg, off) { return (seg * 16) + off; },
    
    updateFlags: function(result) {
        const res16 = result & 0xFFFF;
        if (res16 === 0) machineState.FLAGS |= (1 << 6); else machineState.FLAGS &= ~(1 << 6);
        if (res16 & 0x8000) machineState.FLAGS |= (1 << 7); else machineState.FLAGS &= ~(1 << 7);
        machineState.FLAGS |= 0x0002;
    },
    
    writeMem: function(physAddr, byteVal, desc) {
        machineState.memory[this.padHex(physAddr, 5)] = { val: byteVal & 0xFF, desc: desc };
    },
    
    readMem: function(physAddr) {
        const addrHex = this.padHex(physAddr, 5);
        const data = machineState.memory[addrHex];
        return data ? data.val : 0;
    },

    addHistory: function(type, seg, off, phys) {
        machineState.calcHistory.push({
            type: type,
            segOff: `${this.padHex(seg)}:${this.padHex(off)}`,
            calc: `${this.padHex(seg)}0 + ${this.padHex(off)}`,
            res: `${this.padHex(phys, 5)}`
        });
    },

    // --- PILHA ---
    push: function(value) {
        let sp = (machineState.SP - 2) & 0xFFFF;
        machineState.SP = sp;
        const addr = this.physAddr(machineState.SS, sp);
        this.writeMem(addr, value & 0xFF, "PUSH Low");
        this.writeMem(addr + 1, (value >> 8) & 0xFF, "PUSH High");
        return addr;
    },
    pop: function() {
        const sp = machineState.SP;
        const addr = this.physAddr(machineState.SS, sp);
        const low = this.readMem(addr);
        const high = this.readMem(addr + 1);
        machineState.SP = (sp + 2) & 0xFFFF;
        return (high << 8) | low;
    },

    // --- MONTADOR (ASSEMBLER) ---
    assemble: function(op, dest, src, currentIP) {
        op = op.toUpperCase();
        const regs = ['AX','BX','CX','DX','SI','DI','BP','SP','CS','DS','SS','ES'];

        // 1. MOV MEM, IMM (6 Bytes)
        if (op === 'MOV' && dest.startsWith('[') && src !== "" && !regs.includes(src)) {
            const d = this.hexToInt(dest); const s = this.hexToInt(src);
            return [0xC7, 0x06, d & 0xFF, d >> 8, s & 0xFF, s >> 8];
        }
        
        // 2. MOV AX, IMM (3 Bytes)
        if (op === 'MOV' && dest === 'AX' && !regs.includes(src) && src !== "") {
            const val = this.hexToInt(src); return [0xB8, val & 0xFF, val >> 8];
        }

        // 3. CASOS ESPECÍFICOS
        if (op === 'ADD' && dest === 'BX' && src === 'AX') return [0x01, 0xD8];
        if (op === 'MOV' && dest === '[SI]' && src === 'AX') return [0x89, 0x04];

        // --- OUTROS OPCODES ---
        if (op === 'RET') return [0xC3];
        if (op === 'IRET') return [0xCF];
        if (op === 'PUSHF') return [0x9C];
        if (op === 'POPF') return [0x9D];

        if (op === 'PUSH' && regs.includes(dest)) return [0x50]; 
        if (op === 'POP' && regs.includes(dest)) return [0x58];
        if (op === 'INC' && regs.includes(dest)) return [0x40];
        if (op === 'DEC' && regs.includes(dest)) return [0x48];
        if (op === 'XCHG') return [0x87, 0xC0];

        const binaryOps = {'ADD':0x01, 'OR':0x09, 'ADC':0x11, 'SBB':0x19, 'AND':0x21, 'SUB':0x29, 'XOR':0x31, 'CMP':0x39, 'TEST':0x85};
        if (binaryOps[op]) return [binaryOps[op], 0xC0];

        if (op === 'MUL') return [0xF7, 0xE0];
        if (op === 'DIV') return [0xF7, 0xF0];
        if (op === 'NEG') return [0xF7, 0xD8];
        if (op === 'NOT') return [0xF7, 0xD0];

        if (op === 'JMP') { // JMP Near (3 Bytes)
            const target = this.hexToInt(dest); const nextIP = (currentIP + 3) & 0xFFFF;
            let offset = (target - nextIP) & 0xFFFF; return [0xE9, offset & 0xFF, offset >> 8];
        }
        if (op === 'CALL') { 
            const target = this.hexToInt(dest); const nextIP = (currentIP + 3) & 0xFFFF;
            let offset = (target - nextIP) & 0xFFFF; return [0xE8, offset & 0xFF, offset >> 8];
        }
        
        const jumps = {'JE':0x74, 'JZ':0x74, 'JNE':0x75, 'JNZ':0x75, 'JG':0x7F, 'JGE':0x7D, 'JL':0x7C, 'JLE':0x7E, 'LOOP':0xE2};
        if (jumps[op]) return [jumps[op], 0x00];

        if (op === 'IN') return [0xE4, 0x00];
        if (op === 'OUT') return [0xE6, 0x00];

        return [0x89, 0xC0];
    },

    // --- FETCH (COM VISUALIZAÇÃO DIDÁTICA "MOV") ---
    fetch: function(op, dest, src) {
        let log = "; --- CICLO DE BUSCA (FETCH) ---\n";
        const cs = machineState.CS; const ip = machineState.IP;
        const bytes = this.assemble(op, dest, src, ip);
        const size = bytes.length;
        
        const physStart = this.physAddr(cs, ip);
        this.addHistory("Busca", cs, ip, physStart);
        
        const csHex = this.padHex(cs); const ipHex = this.padHex(ip);
        machineState.calcLog = `CÁLCULO (BUSCA):\nE.F. = (${csHex}H * 10H) + ${ipHex}H\nE.F. = ${csHex}0H + ${ipHex}H = ${this.padHex(physStart, 5)}H`;

        if (machineState.busWidth === 16) {
            for (let i = 0; i < size; i += 2) {
                const phys = this.physAddr(cs, (ip + i) & 0xFFFF);
                const addrHex = this.padHex(phys, 5);
                const low = bytes[i]; const high = (i + 1 < size) ? bytes[i+1] : null;
                
                let descL = this.getDesc(op, size, i);
                this.writeMem(phys, low, descL);
                
                // --- LÓGICA VISUAL ---
                let dataBusStr = "";
                // Se for o PRIMEIRO passo (i==0), mostra o NOME DA INSTRUÇÃO (ex: MOV)
                if (i === 0) {
                    dataBusStr = op; 
                } else {
                    // Senão mostra o valor Hex
                    if (high !== null) dataBusStr = this.padHex(high, 2) + this.padHex(low, 2) + "H";
                    else dataBusStr = this.padHex(low, 2) + "H";
                }

                if(high!==null) this.writeMem(phys+1, high, this.getDesc(op, size, i+1));
                
                log += `Passo ${machineState.busStep++} (MP para MEM): ${addrHex} (BUS END)\n`;
                log += `Passo ${machineState.busStep++} (MEM para MP): ${dataBusStr} (BUS DADOS)\n`;
            }
        } else {
            bytes.forEach((b, i) => {
                const phys = this.physAddr(cs, (ip + i) & 0xFFFF);
                this.writeMem(phys, b, this.getDesc(op, size, i));
                
                // --- LÓGICA VISUAL ---
                let displayData = (i === 0) ? op : (this.padHex(b, 2) + "H");

                log += `Passo ${machineState.busStep++} (MP para MEM): ${this.padHex(phys, 5)} (BUS END)\n`;
                log += `Passo ${machineState.busStep++} (MEM para MP): ${displayData} (BUS DADOS)\n`;
            });
        }
        machineState.IP = (ip + size) & 0xFFFF;
        machineState.calcLog += `\nNovo IP: ${this.padHex(machineState.IP)}H`;
        return log;
    },

    getDesc: function(op, size, i) {
        if (op === 'MOV' && size === 6) return ["Opcode", "ModRM", "Disp L", "Disp H", "Imm L", "Imm H"][i];
        if (op === 'MOV' && size === 3) return ["Opcode", "Imm L", "Imm H"][i];
        if (op === 'ADD' && size === 2) return ["Opcode", "ModRM"][i];
        if (op === 'JMP') return ["Opcode", "Disp L", "Disp H"][i];
        return i===0 ? "Opcode" : "Byte";
    },

    // --- EXECUTE ---
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
            
            this.addHistory("Dados", ds, off, phys);
            const dsHex = this.padHex(ds); const offHex = this.padHex(off);
            machineState.calcLog += `\n\nCÁLCULO (DADOS):\nE.F. = (${dsHex}H * 10H) + ${offHex}H\nE.F. = ${dsHex}0H + ${offHex}H = ${this.padHex(phys, 5)}H`;

            const low = valSrc & 0xFF; const high = (valSrc >> 8) & 0xFF;
            if (machineState.busWidth === 16) {
                log += `Passo ${machineState.busStep++} (MP para MEM): ${this.padHex(phys, 5)} (BUS END)\n`;
                log += `Passo ${machineState.busStep++} (MP para MEM): ${this.padHex(valSrc, 4)}H (BUS DADOS)\n`;
            } else {
                log += `Passo ${machineState.busStep++} (MP para MEM): ${this.padHex(phys, 5)} (BUS END)\nPasso ${machineState.busStep++} (MP para MEM): ${this.padHex(low, 2)}H (BUS DADOS)\n`;
                log += `Passo ${machineState.busStep++} (MP para MEM): ${this.padHex(phys+1, 5)} (BUS END)\nPasso ${machineState.busStep++} (MP para MEM): ${this.padHex(high, 2)}H (BUS DADOS)\n`;
            }
            this.writeMem(phys, low, "Escrita Low"); this.writeMem(phys+1, high, "Escrita High");
        } 
        else if (machineState[dest] !== undefined) { machineState[dest] = valSrc; log += `; Interno: ${dest}=${this.padHex(valSrc)}H\n`; }
        else if (op === 'ADD') { let r=machineState[dest]+valSrc; machineState[dest]=r&0xFFFF; this.updateFlags(r); log+=`; ALU: ${dest}=${this.padHex(machineState[dest])}H\n`; }
        else if (op === 'JMP') { machineState.IP = this.hexToInt(dest); log += `; JMP: IP=${this.padHex(machineState.IP)}H\n`; }
        
        // Outras ops (Simplificado para visualização)
        else if (op === 'PUSH') { 
            const t = machineState[dest]!==undefined?machineState[dest]:this.hexToInt(dest); 
            this.push(t); log+=`; PUSH ${this.padHex(t)}H\n`; 
        }
        else if (op === 'POP') { machineState[dest] = this.pop(); log+=`; POP ${dest}\n`; }
        else if (['INC','DEC','NOT','NEG'].includes(op)) {
            let v = machineState[dest];
            if(op==='INC') v++; else if(op==='DEC') v--; else if(op==='NOT') v=~v; else v=-v;
            machineState[dest] = v & 0xFFFF; this.updateFlags(v); log+=`; ALU (${op})\n`;
        }
        else if (['AND','OR','XOR','SUB','CMP'].includes(op)) {
            let r=0;
            if(op==='AND') r=machineState[dest]&valSrc; else if(op==='OR') r=machineState[dest]|valSrc; else if(op==='XOR') r=machineState[dest]^valSrc; else r=machineState[dest]-valSrc;
            if(op!=='CMP') machineState[dest]=r&0xFFFF; this.updateFlags(r); log+=`; ALU (${op})\n`;
        }
        // Condicionais
        else if (['JE','JNE','JG','JL','LOOP'].includes(op)) {
            const f = machineState.FLAGS;
            const zf=(f>>6)&1; const sf=(f>>7)&1; let j=false;
            if(op==='JE' && zf) j=true; else if(op==='JNE' && !zf) j=true;
            if(j) machineState.IP = this.hexToInt(dest);
            log+=`; ${op} -> ${j?'Salto':'Segue'}\n`;
        }

        return log;
    },

    runStep: function(line) {
        const select = document.getElementById('bus-mode');
        if (select) machineState.busWidth = parseInt(select.value, 10);
        const clean = line.split(';')[0].trim().toUpperCase();
        const match = clean.match(/(\w+)(?:\s+([^,]+)(?:,\s*(.+))?)?$/);
        if (!match) return { error: "Erro" };
        const op=match[1], dest=match[2]?match[2].trim():"", src=match[3]?match[3].trim():"";
        machineState.logs = this.fetch(op, dest, src) + this.execute(op, dest, src);
        return { success: true };
    }
};

// --- UI ---
function padHexUI(num) { return (num & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); }
function highlightChanges(oldState, newState) {
    const keys = ['AX','BX','CX','DX','CS','SS','DS','ES','IP','SP','BP','DI','SI','FLAGS'];
    keys.forEach(key => { if (oldState[key] !== newState[key]) { const el = document.getElementById(key==='FLAGS'?'reg-flag-value':`reg-${key.toLowerCase()}`); if(el){ el.classList.remove('blink'); void el.offsetWidth; el.classList.add('blink'); } } });
}

function updateUI() {
    ['ax','bx','cx','dx','cs','ss','ds','es','ip','sp','bp','di','si'].forEach(r => document.getElementById(`reg-${r}`).textContent = padHexUI(machineState[r.toUpperCase()]) + 'H');
    document.getElementById('reg-flag-value').textContent = padHexUI(machineState.FLAGS) + 'H';

    const memDiv = document.getElementById('memory-view');
    const sortedAddr = Object.keys(machineState.memory).sort((a,b) => parseInt(a,16) - parseInt(b,16));
    let htmlMem = `<table class="memory-table"><thead><tr><th>Endereço</th><th>Valor</th><th>Significado</th></tr></thead><tbody>`;
    sortedAddr.forEach(addr => { const m = machineState.memory[addr]; htmlMem += `<tr><td><b>${addr}H</b></td><td class="mem-val">${SimulatorCore.padHex(m.val, 2)}H</td><td class="mem-desc">${m.desc}</td></tr>`; });
    htmlMem += `</tbody></table>`;
    memDiv.innerHTML = htmlMem;

    const histDiv = document.getElementById('calc-history-view');
    if (histDiv) {
        let htmlHist = `<table class="memory-table"><thead><tr><th>Tipo</th><th>Seg:Off</th><th>Cálculo</th><th>Físico</th></tr></thead><tbody>`;
        machineState.calcHistory.forEach(h => {
            htmlHist += `<tr><td style="color:#79c0ff">${h.type}</td><td>${h.segOff}</td><td style="font-size:0.85em">${h.calc}</td><td class="mem-val">${h.res}H</td></tr>`;
        });
        htmlHist += `</tbody></table>`;
        histDiv.innerHTML = htmlHist;
        histDiv.scrollTop = histDiv.scrollHeight;
    }
    const calcMidDiv = document.getElementById('address-calculation-output');
    if (calcMidDiv) calcMidDiv.innerText = machineState.calcLog;
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
    if (action === 'init') { stopAutoRun(); simulateExecution('reset'); if(loadCode()) updateUI(); return; }
    if (action === 'reset') {
        stopAutoRun();
        const select = document.getElementById('bus-mode');
        const currentMode = select ? parseInt(select.value, 10) : 8;
        machineState = {
            AX: 0, BX: 0, CX: 0, DX: 0, CS: 0x4000, SS: 0x5000, DS: 0x6000, ES: 0x7000, 
            IP: 0xAE00, SP: 0xFFFE, BP: 0, DI: 0, SI: 0x0010, FLAGS: 0x0002,
            memory: {}, instructions: [], currentInstructionIndex: 0, busStep: 1,
            logs: "", calcLog: "", calcHistory: [], busWidth: currentMode
        };
        document.getElementById('fluxo-output').textContent = "Simulador Resetado.";
        document.getElementById('address-calculation-output').textContent = "";
        document.getElementById('status-message').textContent = "Simulador Resetado.";
        updateUI();
        return;
    }
    if (machineState.instructions.length === 0 || machineState.currentInstructionIndex >= machineState.instructions.length) { stopAutoRun(); return; }
    const line = machineState.instructions[machineState.currentInstructionIndex];
    const oldState = { ...machineState };
    const result = SimulatorCore.runStep(line);
    if (result.error) { document.getElementById('status-message').textContent = `Erro: ${result.error}`; stopAutoRun(); return; }
    highlightChanges(oldState, machineState);
    updateUI();
    const flux = document.getElementById('fluxo-output');
    flux.textContent += `\n\n[${padHexUI(machineState.currentInstructionIndex)}] ${line}\n${machineState.logs}`;
    flux.scrollTop = flux.scrollHeight;
    document.getElementById('status-message').textContent = `Executada: ${line}`;
    machineState.currentInstructionIndex++;
    if (machineState.currentInstructionIndex >= machineState.instructions.length) {
        document.getElementById('status-message').textContent = "Fim da execução.";
        stopAutoRun();
    }
}

function toggleAutoRun() {
    if (autoRunInterval) stopAutoRun();
    else {
        const btn = document.getElementById('btn-autorun');
        btn.textContent = "Parar"; btn.style.backgroundColor = "#da3633";
        simulateExecution('step');
        autoRunInterval = setInterval(() => simulateExecution('step'), AUTO_RUN_DELAY);
    }
}

function stopAutoRun() {
    if (autoRunInterval) { clearInterval(autoRunInterval); autoRunInterval = null; }
    const btn = document.getElementById('btn-autorun');
    if (btn) { btn.textContent = "Executar Tudo"; btn.style.backgroundColor = ""; }
}

function changeBusMode() { document.getElementById('status-message').textContent = "Modo alterado. Resete para aplicar."; }
document.addEventListener('DOMContentLoaded', updateUI);
