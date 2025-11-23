// script.js (VERSÃO FINAL: SIMULADOR TOTALMENTE EM JAVASCRIPT)

// --- CONFIGURAÇÃO ---
const AUTO_RUN_DELAY = 500; 
let autoRunInterval = null;

// --- ESTADO DA MÁQUINA ---
let machineState = {
    AX: 0x0000, BX: 0x0000, CX: 0x0000, DX: 0x0000,
    CS: 0x1000, SS: 0x2000, DS: 0x3000, ES: 0x4000,
    IP: 0x0100, SP: 0xFFFE, BP: 0x0000, DI: 0x0000, SI: 0x0010,
    FLAGS: 0x0002,
    memory: {}, // { 'addressHex': { val: 0x00, desc: '...' } }
    instructions: [],
    currentInstructionIndex: 0,
    busStep: 1,
    logs: "",     // Armazena o log de fluxo
    calcLog: ""   // Armazena o log de cálculo
};

// ============================================================================
//  CORE DO SIMULADOR (ANTIGO BACKEND.PY TRADUZIDO PARA JS)
// ============================================================================

const SimulatorCore = {
    
    // --- UTILITÁRIOS ---
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

    // --- UPDATE FLAGS ---
    updateFlags: function(result) {
        const res16 = result & 0xFFFF;
        
        // Zero Flag (Bit 6)
        if (res16 === 0) machineState.FLAGS |= (1 << 6);
        else machineState.FLAGS &= ~(1 << 6);
        
        // Sign Flag (Bit 7)
        if (res16 & 0x8000) machineState.FLAGS |= (1 << 7);
        else machineState.FLAGS &= ~(1 << 7);
        
        // (Bit 1 Reservado sempre 1)
        machineState.FLAGS |= 0x0002;
    },

    // --- STACK ---
    push: function(value) {
        let sp = (machineState.SP - 2) & 0xFFFF;
        machineState.SP = sp;
        const addr = this.physAddr(machineState.SS, sp);
        
        // Write Memory
        this.writeMem(addr, value & 0xFF, "PUSH Low");
        this.writeMem(addr + 1, (value >> 8) & 0xFF, "PUSH High");
        return addr;
    },

    pop: function() {
        const sp = machineState.SP;
        const addr = this.physAddr(machineState.SS, sp);
        
        const low = this.readMem(addr);
        const high = this.readMem(addr + 1);
        const val = (high << 8) | low;
        
        machineState.SP = (sp + 2) & 0xFFFF;
        return val;
    },

    // --- MEMORY HELPERS ---
    writeMem: function(physAddr, byteVal, desc) {
        const addrHex = this.padHex(physAddr, 5);
        machineState.memory[addrHex] = { val: byteVal & 0xFF, desc: desc };
    },

    readMem: function(physAddr) {
        const addrHex = this.padHex(physAddr, 5);
        const data = machineState.memory[addrHex];
        return data ? data.val : 0;
    },

    // --- MONTADOR (ASSEMBLER) ---
    assemble: function(op, dest, src, currentIP) {
        op = op.toUpperCase();
        
        // 1. MOV AX, IMM (Opcode B8)
        if (op === 'MOV' && dest === 'AX') {
            if (!['AX','BX','CX','DX','SI','DI','BP','SP'].includes(src) && src !== "") {
                const val = this.hexToInt(src);
                return [0xB8, val & 0xFF, val >> 8];
            }
        }

        // 2. ADD BX, AX (Opcode 01 D8)
        if (op === 'ADD' && dest === 'BX' && src === 'AX') return [0x01, 0xD8];

        // 3. MOV [SI], AX (Opcode 89 04)
        if (op === 'MOV' && dest === '[SI]' && src === 'AX') return [0x89, 0x04];

        // 4. JMP (Salto Relativo)
        if (op === 'JMP') {
            const target = this.hexToInt(dest);
            const nextIP = (currentIP + 3) & 0xFFFF;
            let offset = (target - nextIP) & 0xFFFF;
            return [0xE9, offset & 0xFF, offset >> 8];
        }

        // 5. MOV MEM, IMM (6 Bytes)
        if (op === 'MOV' && dest.startsWith('[') && src !== "" && !src.match(/[A-Z]/)) {
            const d = this.hexToInt(dest);
            const s = this.hexToInt(src);
            return [0xC7, 0x06, d & 0xFF, d >> 8, s & 0xFF, s >> 8];
        }

        // Fallbacks Genéricos
        const mapOp = {
            'MOV': 0x89, 'ADD': 0x01, 'SUB': 0x29, 'CMP': 0x39,
            'AND': 0x21, 'OR': 0x09, 'XOR': 0x31, 'INC': 0x40, 'DEC': 0x48,
            'PUSH': 0x50, 'POP': 0x58, 'CALL': 0xE8, 'RET': 0xC3
        };
        const base = mapOp[op] || 0x90; // NOP default
        
        if (op.startsWith('J') && op !== 'JMP') return [0x70, 0x00]; // Short Jump
        if (['INC', 'DEC', 'PUSH', 'POP'].includes(op)) return [base];
        
        return [base, 0xC0]; // Default 2 bytes
    },

    // --- FETCH CYCLE ---
    fetch: function(op, dest, src) {
        let log = "; --- CICLO DE BUSCA (FETCH) ---\n";
        const cs = machineState.CS;
        const ip = machineState.IP;
        
        const bytes = this.assemble(op, dest, src, ip);
        const size = bytes.length;

        bytes.forEach((byteVal, i) => {
            const phys = this.physAddr(cs, (ip + i) & 0xFFFF);
            const addrHex = this.padHex(phys, 5);
            
            log += `passo ${machineState.busStep++} ${addrHex} (BUS END) mp para mem\n`;
            
            // Descrição inteligente
            let desc = "Byte";
            if (op === 'MOV' && size === 6) desc = ["Opcode", "ModR/M", "Disp L", "Disp H", "Data L", "Data H"][i];
            else if (op === 'JMP') desc = ["Opcode", "Disp L", "Disp H"][i];
            else if (i === 0) desc = `Opcode (${op})`;
            else desc = "Operando/ModRM";

            log += `passo ${machineState.busStep++} ${this.padHex(byteVal, 2)}H (BUS DADOS) mem para mp ; ${desc}\n`;
            
            // Salva na memória (Simulação de código carregado)
            this.writeMem(phys, byteVal, desc);
        });

        const newIP = (ip + size) & 0xFFFF;
        machineState.calcLog = `Busca: CS:IP = ${this.padHex(cs)}:${this.padHex(ip)}H\n` +
                               `Endereço Físico: ${this.padHex(this.physAddr(cs, ip), 5)}H\n` +
                               `Novo IP: ${this.padHex(newIP)}H`;
        
        machineState.IP = newIP;
        return log;
    },

    // --- EXECUTE CYCLE ---
    execute: function(op, dest, src) {
        let log = `; --- CICLO DE EXECUÇÃO (${op}) ---\n`;
        op = op.toUpperCase();
        
        // Resolve valores
        let valDest = machineState[dest] !== undefined ? machineState[dest] : this.hexToInt(dest);
        let valSrc = machineState[src] !== undefined ? machineState[src] : (src ? this.hexToInt(src) : 0);

        // Lógica das Instruções
        if (op === 'MOV') {
            if (dest.startsWith('[')) {
                // Escrita na Memória
                const ds = machineState.DS;
                let off = this.hexToInt(dest);
                if (dest === '[SI]') off = machineState.SI;
                if (dest === '[DI]') off = machineState.DI;
                
                const phys = this.physAddr(ds, off);
                
                // Write 16-bit
                for (let i = 0; i < 2; i++) {
                    const byteData = (valSrc >> (i * 8)) & 0xFF;
                    const addr = phys + i;
                    const addrStr = this.padHex(addr, 5);
                    
                    log += `passo ${machineState.busStep++} ${addrStr} (BUS END) mp para mem\n`;
                    log += `passo ${machineState.busStep++} ${this.padHex(byteData, 2)}H (BUS DADOS) mp para mem ; Escrita\n`;
                    
                    this.writeMem(addr, byteData, `Escrita ${op}`);
                }
                machineState.calcLog += `\nEscrita em DS:OFF ${this.padHex(ds)}:${this.padHex(off)}H`;

            } else if (machineState[dest] !== undefined) {
                // Reg to Reg
                machineState[dest] = valSrc;
                log += `; Interno: ${dest} = ${this.padHex(valSrc)}H\n`;
            }
        }
        
        else if (['ADD', 'SUB', 'AND', 'OR', 'XOR'].includes(op)) {
            let res = 0;
            if (op === 'ADD') res = valDest + valSrc;
            if (op === 'SUB') res = valDest - valSrc;
            // ... outros
            
            machineState[dest] = res & 0xFFFF;
            this.updateFlags(res);
            log += `; ALU: ${dest} = ${this.padHex(machineState[dest])}H\n`;
        }

        else if (op === 'JMP') {
            machineState.IP = this.hexToInt(dest);
            log += `; JMP: IP = ${this.padHex(machineState.IP)}H\n`;
        }

        else if (op === 'PUSH') {
            const target = machineState[dest] !== undefined ? machineState[dest] : this.hexToInt(dest);
            this.push(target);
            log += `; Pilha: PUSH ${this.padHex(target)}H\n`;
        }

        else if (op === 'POP' && machineState[dest] !== undefined) {
            machineState[dest] = this.pop();
            log += `; Pilha: POP para ${dest}\n`;
        }

        return log;
    },

    // --- MAIN STEP FUNCTION ---
    runStep: function(line) {
        const cleanLine = line.split(';')[0].trim().toUpperCase();
        const match = cleanLine.match(/(\w+)(?:\s+([^,]+)(?:,\s*(.+))?)?$/);
        
        if (!match) return { error: "Sintaxe inválida" };
        
        const op = match[1];
        const dest = match[2] ? match[2].trim() : "";
        const src = match[3] ? match[3].trim() : "";

        const logFetch = this.fetch(op, dest, src);
        const logExec = this.execute(op, dest, src);
        
        machineState.logs = logFetch + logExec;
        return { success: true };
    }
};

// ============================================================================
//  INTERFACE DE USUÁRIO (UI)
// ============================================================================

function padHexUI(num) { 
    return (num & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); 
}

function highlightChanges(oldState, newState) {
    const keys = ['AX','BX','CX','DX','CS','SS','DS','ES','IP','SP','BP','DI','SI','FLAGS'];
    keys.forEach(key => {
        if (oldState[key] !== newState[key]) {
            // Mapeamento de ID especial para FLAGS, outros são reg-chave
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
    // Atualiza Registradores
    ['ax','bx','cx','dx','cs','ss','ds','es','ip','sp','bp','di','si'].forEach(r => {
        document.getElementById(`reg-${r}`).textContent = padHexUI(machineState[r.toUpperCase()]) + 'H';
    });
    document.getElementById('reg-flag-value').textContent = padHexUI(machineState.FLAGS) + 'H';

    // Atualiza Tabela de Memória
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

// --- CONTROLES ---

function loadCode() {
    const raw = document.getElementById('assembly-code').value;
    machineState.instructions = raw.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith(';'));
    
    if (machineState.instructions.length === 0) {
        alert("Nenhum código válido!");
        return false;
    }
    
    machineState.currentInstructionIndex = 0;
    document.getElementById('status-message').textContent = `Carregado. ${machineState.instructions.length} instruções.`;
    return true;
}

// --- FUNÇÃO PRINCIPAL (Substitui a chamada ao Backend) ---
async function simulateExecution(action) {
    
    if (action === 'init') {
        stopAutoRun();
        simulateExecution('reset');
        if(loadCode()) updateUI();
        return;
    }

    if (action === 'reset') {
        stopAutoRun();
        // Reset State
        machineState.AX = 0; machineState.BX = 0; machineState.CX = 0; machineState.DX = 0;
        machineState.CS = 0x1000; machineState.SS = 0x2000; machineState.DS = 0x3000; machineState.ES = 0x4000;
        machineState.IP = 0x0100; machineState.SP = 0xFFFE; machineState.BP = 0; 
        machineState.DI = 0; machineState.SI = 0x0010; machineState.FLAGS = 0x0002;
        machineState.memory = {};
        machineState.currentInstructionIndex = 0;
        machineState.busStep = 1;
        machineState.logs = "";
        machineState.calcLog = "";
        
        document.getElementById('fluxo-output').textContent = "Simulador Resetado.";
        document.getElementById('address-calculation-output').textContent = "";
        document.getElementById('status-message').textContent = "Pronto.";
        updateUI();
        return;
    }

    // Executar Passo
    if (machineState.instructions.length === 0) return;
    if (machineState.currentInstructionIndex >= machineState.instructions.length) {
        document.getElementById('status-message').textContent = "Fim do Código.";
        stopAutoRun();
        return;
    }

    const line = machineState.instructions[machineState.currentInstructionIndex];
    
    // Salva estado antigo para comparação visual
    const oldState = { ...machineState };

    // EXECUTA LÓGICA LOCAL (Sem fetch)
    const result = SimulatorCore.runStep(line);

    if (result.error) {
        document.getElementById('status-message').textContent = `Erro: ${result.error}`;
        stopAutoRun();
        return;
    }

    // Atualiza UI
    highlightChanges(oldState, machineState);
    updateUI();
    
    // Logs
    const flux = document.getElementById('fluxo-output');
    flux.textContent += `\n\n[${padHexUI(machineState.currentInstructionIndex)}] ${line}\n${machineState.logs}`;
    flux.scrollTop = flux.scrollHeight;
    
    document.getElementById('address-calculation-output').textContent = machineState.calcLog;
    
    machineState.currentInstructionIndex++;
    
    if (machineState.currentInstructionIndex < machineState.instructions.length) {
        document.getElementById('status-message').textContent = `Executada: ${line}`;
    } else {
        document.getElementById('status-message').textContent = "Fim da execução.";
        stopAutoRun();
    }
}

// --- AUTO RUN ---
function toggleAutoRun() {
    if (autoRunInterval) stopAutoRun();
    else {
        if (machineState.instructions.length === 0 || machineState.currentInstructionIndex >= machineState.instructions.length) return;
        
        const btn = document.getElementById('btn-autorun');
        btn.textContent = "Parar";
        btn.style.backgroundColor = "#da3633";
        
        simulateExecution('step');
        autoRunInterval = setInterval(() => {
            if (machineState.currentInstructionIndex >= machineState.instructions.length) stopAutoRun();
            else simulateExecution('step');
        }, AUTO_RUN_DELAY);
    }
}

function stopAutoRun() {
    if (autoRunInterval) { clearInterval(autoRunInterval); autoRunInterval = null; }
    const btn = document.getElementById('btn-autorun');
    if (btn) { btn.textContent = "Executar Tudo"; btn.style.backgroundColor = ""; }
}

document.addEventListener('DOMContentLoaded', updateUI);
