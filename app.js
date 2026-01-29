// ================= CONFIGURAÇÕES =================
const supabaseUrl = 'https://dwuaiqfvseridxcadduu.supabase.co' 
const supabaseKey = 'sb_publishable_HX71d-G-UBaRM16Vz0fH4A_ZoF44IEE' 
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey)

// Globais
let currentDashboardDate = new Date()
let globalTransactions=[], globalCards=[], globalCategories=[], globalInvestments=[], globalAccounts=[]
let editingTransactionId=null, editingCardId=null, editingCategoryId=null, editingInvestmentId=null, editingAccountId=null
let pendingDeleteId = null;
let myChart=null, investmentChart=null
let isLoading = false 
let currentFilterType = 'all'; 
let currentCategoryFilter = 'all';
let pendingEditData = null; 
let originalEditData = null;

// ==========================================
// 1. SISTEMA DE MODAIS (LIMPO E SIMPLES)
// ==========================================

// Função Genérica para ABRIR qualquer modal
window.showModal = function(id) {
    const el = document.getElementById(id);
    if(el) {
        el.classList.remove('hidden'); // O CSS cuida do resto (flex, z-index, animação)
    } else {
        console.error(`Modal não encontrado: ${id}`);
    }
}

// Função Genérica para FECHAR qualquer modal
window.hideModal = function(id) {
    const el = document.getElementById(id);
    if(el) {
        el.classList.add('hidden');
    }
}

// Função Auxiliar: Formatar Números (Evitar NaN)
const safeNumber = (value) => {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    let clean = value.toString().replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    return parseFloat(clean) || 0;
}

// ==========================================
// 2. AUTENTICAÇÃO
// ==========================================
async function checkUser() {
    const { data: { session } } = await supabaseClient.auth.getSession()

    if (session) {
        document.getElementById('login-screen').classList.add('hidden')
        document.getElementById('app-layout').classList.remove('hidden')

        document.getElementById('user-email').innerText = session.user.email
        updateGreeting(session.user.email);
        updateDateDisplay();

        await loadDropdowns(session.user.id);
        
        showSection('dashboard');
        
        updateAccountsWidget(session.user.id);
        fetchGoals(session.user.id);
        processFixedExpenses(session.user.id); 

    } else {
        document.getElementById('login-screen').classList.remove('hidden')
        document.getElementById('app-layout').classList.add('hidden')
    }
}

async function login() {
    const email = document.getElementById('email').value
    const password = document.getElementById('password').value
    if(!email || !password) return showToast("Preencha todos os campos!", 'info')
    
    const btn = document.getElementById('btnLogin');
    const oldText = btn.innerText;
    btn.innerText = "Entrando...";
    btn.disabled = true;
    
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password })
    
    if (error) {
        showToast("Erro: " + error.message, 'error');
        btn.innerText = oldText;
        btn.disabled = false;
    } else {
        checkUser();
    }
}

async function logout() {
    await supabaseClient.auth.signOut()
    location.reload()
}

document.getElementById('btnLogin').addEventListener('click', login);
document.getElementById('btnLogout').addEventListener('click', logout);

// ==========================================
// 3. NAVEGAÇÃO
// ==========================================
window.showSection = function(id) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'))
    document.getElementById('view-'+id).classList.remove('hidden')
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'))
    const activeBtn = document.querySelector(`.nav-item[onclick="showSection('${id}')"]`)
    if(activeBtn) activeBtn.classList.add('active')
    
    refreshCurrentView()
}


async function refreshCurrentView() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    try {
        await Promise.all([
            fetchTransactions(user.id),      // Extrato
            fetchGoals(user.id),             // Metas
            fetchCategories(),               // Categorias
            fetchCards(user.id),             // Cartões
            fetchInvestments(user.id),       // Investimentos
            updateAccountsWidget(user.id)    // <--- ADICIONADO AQUI (Agora carrega em paralelo)
        ]);

        if (!document.getElementById('view-dashboard').classList.contains('hidden')) {
            updateChart(); 
        }

    } catch (error) {
        console.error("Erro ao atualizar dados:", error);
    }
}

function updateDateDisplay() {
    const text = currentDashboardDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase()
    const ids = ['current-month-display', 'current-month-display-extrato', 'current-month-display-cards', 'current-month-display-invest']
    ids.forEach(id => { const el = document.getElementById(id); if(el) el.innerText = text; })
}

window.changeMonth = async function(step) {
    if(isLoading) return; 
    isLoading = true;

    currentDashboardDate.setDate(1); 
    
    currentDashboardDate.setMonth(currentDashboardDate.getMonth() + step);
    
    updateDateDisplay();
    
    const { data: { user } } = await supabaseClient.auth.getUser();
    if(user) await processFixedExpenses(user.id);

    await refreshCurrentView();
    setTimeout(() => { isLoading = false }, 300); 
}

function updateGreeting(userEmail) {
    const hour = new Date().getHours()
    const greeting = hour < 12 ? '👋 Bom dia,' : (hour < 18 ? '👋 Boa tarde,' : '👋 Boa noite,');
    const el = document.getElementById('welcome-greeting');
    if(el) el.innerText = greeting;

    const nameDisplay = document.getElementById('user-name-display');
    if (userEmail && nameDisplay) {
        const nickname = userEmail.split('@')[0];
        nameDisplay.innerText = nickname.charAt(0).toUpperCase() + nickname.slice(1);
    }
}

window.toggleTheme = () => {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
    
    const icon = document.getElementById('theme-icon');
    const text = document.getElementById('theme-text');
    if(icon) icon.className = isDark ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    if(text) text.innerText = isDark ? 'Modo Escuro' : 'Modo Claro';
    
    refreshCurrentView(); 
}
if(localStorage.getItem('theme') === 'dark') window.toggleTheme();


// ==========================================
// 4. TRANSAÇÕES (MOVIMENTAÇÕES)
// ==========================================
window.openModal = (type = 'expense') => {
    editingTransactionId = null;
    document.getElementById('form').reset();
    document.querySelector('#modal-overlay h3').innerText = 'Nova Movimentação';
    
    // Abre modal
    window.showModal('modal-overlay');
    
    // Reseta a visibilidade dos campos extras
    document.getElementById('card-select-container').classList.add('hidden');
    document.getElementById('installments-wrapper').classList.add('hidden');
    document.getElementById('installments-count').classList.add('hidden');
    
    // Define o tipo
    setType(type);
    document.getElementById('date').value = new Date().toISOString().split('T')[0];
    
    // Garante que o select comece em Débito
    document.getElementById('transaction-payment-method').value = 'debit';
}

window.closeModal = () => window.hideModal('modal-overlay');

async function fetchTransactions() {
    const { data: { user } } = await supabaseClient.auth.getUser()
    
    // REMOVIDO: updateAccountsWidget(user.id);  <-- Vamos mover pro Promise.all
    // REMOVIDO: fetchGoals(user.id);            <-- Já está no Promise.all (estava duplicado)

    // ... O RESTO DO CÓDIGO CONTINUA IGUAL ...
    // (Atualiza saldo, renderiza lista, renderiza gráficos, etc)
    const year = currentDashboardDate.getFullYear(), month = currentDashboardDate.getMonth()
    const start = new Date(year, month, 1).toISOString()
    const end = new Date(year, month + 1, 0).toISOString()
    
    const { data: trans } = await supabaseClient
        .from('transactions')
        .select(`*, categories (name)`)
        .eq('user_id', user.id)
        .gte('date', start)
        .lte('date', end)
        .order('date', {ascending: false})
    
    globalTransactions = trans || []
    
    // ... continuação normal da função ...
    // (Lógica de income, expense, chart rendering, etc)
    let income=0, expense=0, cats={}
    globalTransactions.forEach(t => {
        if(t.type === 'income') { income += t.amount } 
        else { expense += t.amount; const cName = t.categories?.name || 'Outros'; cats[cName] = (cats[cName] || 0) + t.amount }
    })

    if(document.getElementById('display-income')) document.getElementById('display-income').innerText = `R$ ${income.toLocaleString('pt-br',{minimumFractionDigits:2})}`
    if(document.getElementById('display-expense')) document.getElementById('display-expense').innerText = `R$ ${expense.toLocaleString('pt-br',{minimumFractionDigits:2})}`
    
    const balance = income - expense;
    if(document.getElementById('display-balance')) {
        document.getElementById('display-balance').innerText = `R$ ${balance.toLocaleString('pt-br',{minimumFractionDigits:2})}`;
        const labelSaldo = document.querySelector('#card-balance-bg small');
        if(labelSaldo) labelSaldo.innerText = "SALDO PREVISTO";
        const cardBg = document.getElementById('card-balance-bg');
        if(cardBg) {
            if(balance < 0) { cardBg.style.background = '#fef2f2'; cardBg.style.color = '#991b1b'; } 
            else { cardBg.style.background = '#eff6ff'; cardBg.style.color = '#1e40af'; }
        }
    }

    renderExpenseChart(cats); 
    renderInvestmentChart(user.id);
    applyFilters();
}

// --- LÓGICA DE FILTROS ATUALIZADA ---
window.applyFilters = () => {
    const term = document.getElementById('trans-search')?.value.toLowerCase() || '';
    
    const filtered = globalTransactions.filter(t => {
        // 1. Filtro de Texto (Busca)
        const matchesTerm = t.description.toLowerCase().includes(term) || (t.categories?.name || '').toLowerCase().includes(term);
        
        // 2. Filtro de Tipo (Entrada/Saída)
        const matchesType = currentFilterType === 'all' || t.type === currentFilterType;
        
        // 3. NOVO: Filtro de Categoria (Abas)
        let matchesCategory = true;
        if (currentCategoryFilter === 'fixed') {
            matchesCategory = t.is_fixed === true;
        } else if (currentCategoryFilter === 'card') {
            matchesCategory = t.payment_method === 'credit_card';
        } else if (currentCategoryFilter === 'variable') {
            // Variável = Não é fixa E não é cartão
            matchesCategory = !t.is_fixed && t.payment_method !== 'credit_card';
        }

        return matchesTerm && matchesType && matchesCategory;
    });
    
    renderList(filtered);
}

window.setCategoryFilter = (catType, btn) => {
    // Atualiza visual dos botões
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Define o filtro e reaplica
    currentCategoryFilter = catType;
    applyFilters();
}



window.setFilter = (type, btnElement) => {
    currentFilterType = type;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
    applyFilters();
}

function renderList(listData) {
    const list = document.getElementById('transactions-full');
    const preview = document.getElementById('transactions-preview');
    const noResults = document.getElementById('no-results');

    if(list) list.innerHTML = ''; 
    if(preview) preview.innerHTML = '';

    if(listData.length === 0) {
        if(noResults) noResults.classList.remove('hidden');
        return;
    } else {
        if(noResults) noResults.classList.add('hidden');
    }
    
    listData.forEach((t, i) => {
        const isInc = t.type === 'income'
        const dateStr = new Date(t.date).toLocaleDateString('pt-BR', {timeZone:'UTC'})
        const catName = t.categories?.name || 'Sem categoria';
        
        // Ícone Interativo
        const statusIcon = t.is_paid 
            ? '<i class="fa-solid fa-check-circle" style="color:var(--success)" title="Pago"></i>' 
            : '<i class="fa-regular fa-circle" style="color:#cbd5e1" title="Marcar como pago"></i>';

        const html = `
        <li class="transaction-item" style="display:flex; justify-content:space-between; align-items:center; padding:15px 0; border-bottom:1px solid #f1f5f9">
            <div style="display:flex; align-items:center; gap:15px">
                <div class="check-btn-wrapper" onclick="toggleStatus('${t.id}', ${t.is_paid})">
                    ${statusIcon}
                </div>
                
                <div>
                    <strong style="font-size:0.95rem">${t.description}</strong>
                    <div style="font-size:0.75rem; color:#64748b; margin-top:2px">
                        <span style="background:#f1f5f9; padding:2px 6px; border-radius:4px">${catName}</span> • ${dateStr}
                        ${t.is_fixed ? '<i class="fa-solid fa-thumbtack" style="margin-left:5px; color:#f59e0b; font-size:0.7rem" title="Fixo"></i>' : ''}
                        ${t.payment_method === 'credit_card' ? '<i class="fa-solid fa-credit-card" style="margin-left:5px; color:#3b82f6; font-size:0.7rem" title="Cartão"></i>' : ''}
                    </div>
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:15px">
                <div style="font-weight:700; font-size:0.95rem; color:${isInc?'var(--success)':'var(--danger)'}">
                    ${isInc?'+':'-'} R$ ${t.amount.toLocaleString('pt-br',{minimumFractionDigits:2})}
                </div>
                <div class="action-buttons">
                    <button class="action-btn" onclick="prepareEdit('${t.id}')"><i class="fa-solid fa-pen"></i></button>
                    <button class="action-btn delete" onclick="removeTrans('${t.id}')"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        </li>`

        if(list) list.innerHTML += html
        if(preview && i < 5) preview.innerHTML += html
    })
}

window.toggleStatus = async (id, currentStatus) => {
    // Inverte o status atual
    const newStatus = !currentStatus;
    
    // Atualiza no banco
    const { error } = await supabaseClient
        .from('transactions')
        .update({ is_paid: newStatus })
        .eq('id', id);

    if(error) {
        alert("Erro ao atualizar status: " + error.message);
    } else {
        fetchTransactions();
        if(newStatus) {
            console.log("Pago!");
        }
    }
}

// ============================================================
// LÓGICA DE SALVAR/EDITAR COM PERGUNTA DE RECORRÊNCIA
// ============================================================

// 1. O Listener do Formulário (Intercepta o clique em Salvar)
document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = (await supabaseClient.auth.getUser()).data.user;
    
    // Coleta os dados do formulário
    const amountVal = document.getElementById('amount').value.replace(/\./g, '').replace(',', '.');
    const desc = document.getElementById('description').value;
    const date = document.getElementById('date').value;
    const cat = document.getElementById('category').value;
    const type = document.getElementById('type').value;
    const paymentMethod = document.getElementById('transaction-payment-method').value;
    const isPaid = document.getElementById('check-paid').checked;
    const isFixed = document.getElementById('check-fixed').checked;
    const isInstallment = document.getElementById('check-installments').checked;

    let accId = null;
    let creditCardId = null;

    if (paymentMethod === 'credit_card') {
        creditCardId = document.getElementById('transaction-card-input').value;
        if (!creditCardId) return showToast("Selecione um cartão!", 'info');
    } else {
        const accEl = document.getElementById('account');
        if(accEl) accId = accEl.value;
        if (!accId) return showToast("Selecione uma conta/carteira!", 'info');
    }

    // Monta o objeto com os DADOS NOVOS
    const newData = {
        user_id: user.id,
        amount: parseFloat(amountVal),
        description: desc,
        date: date, 
        category_id: cat,
        account_id: accId,
        type: type,
        is_paid: isPaid,
        is_fixed: isFixed,
        payment_method: paymentMethod,
        credit_card_id: creditCardId
    };

    // --- AQUI ACONTECE A MÁGICA DA DECISÃO ---
    
    if (editingTransactionId) {
        // É UMA EDIÇÃO. Vamos verificar se precisa perguntar.
        const original = globalTransactions.find(t => t.id == editingTransactionId);
        
        // Se a conta ERA fixa E continua marcada como fixa...
        if (original && original.is_fixed) {
            // PAUSA TUDO! Guarda os dados e abre a pergunta.
            pendingEditData = newData;      
            originalEditData = original;    
            window.showModal('modal-edit-confirm'); // Abre o modal azul
            return; // Sai da função e espera o usuário responder no modal
        }
        
        // Se não for fixa, salva direto (Modo Simples)
        await executeUpdate(newData, 'single');
        
    } else {
        // É UMA CRIAÇÃO NOVA (Lógica de parcelas)
        let installmentsCount = 1;
        if (isInstallment && paymentMethod === 'credit_card') {
            installmentsCount = parseInt(document.getElementById('installments-count').value);
            if (!installmentsCount || installmentsCount < 2) return showToast("Mínimo 2 parcelas.", 'info');
        }
        
        await createNewTransaction(newData, installmentsCount);
    }
});

// 2. Funções que o Modal Azul chama
window.closeEditConfirmModal = () => {
    window.hideModal('modal-edit-confirm');
    pendingEditData = null;
    originalEditData = null;
}

window.confirmEdit = async (mode) => {
    if(!pendingEditData) return;
    await executeUpdate(pendingEditData, mode);
    window.closeEditConfirmModal();
}

// 3. Função que Executa a Atualização no Banco (Single ou All)
async function executeUpdate(data, mode) {
    try {
        if (mode === 'single') {
            // MODO 1: Atualiza SÓ ESTE ID
            const { error } = await supabaseClient
                .from('transactions')
                .update(data)
                .eq('id', editingTransactionId);
            if(error) throw error;
        } 
        else if (mode === 'all') {
            // MODO 2: Atualiza TODOS da série (Baseado no nome original)
            
            // Removemos 'date' e 'is_paid' para não bagunçar o histórico/futuro
            const { date, is_paid, ...dataForOthers } = data;
            
            // A. Atualiza o atual completamente (incluindo data e status)
            await supabaseClient.from('transactions').update(data).eq('id', editingTransactionId);

            // B. Atualiza os "irmãos" (busca pelo nome ANTIGO e tipo)
            const { error } = await supabaseClient
                .from('transactions')
                .update(dataForOthers) // Atualiza valor, nome novo, categoria...
                .eq('user_id', data.user_id)
                .eq('description', originalEditData.description) // Busca quem tinha o nome velho
                .eq('is_fixed', true)
                .neq('id', editingTransactionId); // Não mexe no atual de novo
                
            if(error) throw error;
        }

        window.hideModal('modal-overlay');
        fetchTransactions();
        if(data.payment_method === 'credit_card') fetchCards();

    } catch (error) {
       showToast("Erro: " + error.message, 'error');
    }
}

// 4. Função Separada para Criar Nova (pra organizar o código)
async function createNewTransaction(data, installmentsCount) {
    let error = null;
    const baseAmount = data.amount;
    const installmentValue = installmentsCount > 1 ? (baseAmount / installmentsCount) : baseAmount;
    
    const loopCount = installmentsCount;

    for (let i = 0; i < loopCount; i++) {
        let finalDate = new Date(data.date);
        finalDate.setMonth(finalDate.getMonth() + i);
        
        let finalDesc = data.description;
        if (installmentsCount > 1) finalDesc = `${data.description} (${i + 1}/${installmentsCount})`;

        const payload = {
            ...data,
            amount: installmentValue,
            description: finalDesc,
            date: finalDate.toISOString().split('T')[0],
            installments_total: installmentsCount > 1 ? installmentsCount : 1,
            installment_number: installmentsCount > 1 ? (i + 1) : 1
        };

        const { error: err } = await supabaseClient.from('transactions').insert([payload]);
        error = err;
        if(error) break;
    }

    if (error) alert("Erro: " + error.message);
    else {
        window.hideModal('modal-overlay'); 
        showToast('Operação realizada com sucesso!', 'success');
        fetchTransactions(); 
        if(data.payment_method === 'credit_card') fetchCards();
    }
}

// EDITAR TRANSAÇÃO
window.prepareEdit = async (id) => {
    const t = globalTransactions.find(tr => tr.id == id);
    if (!t) return;

    editingTransactionId = id;
    document.querySelector('#modal-overlay h3').innerText = 'Editar Movimentação';
    
    // Abre a MOVIMENTAÇÃO (ID correto)
    window.showModal('modal-overlay');
    
    document.getElementById('amount').value = t.amount.toLocaleString('pt-br', {minimumFractionDigits:2});
    document.getElementById('description').value = t.description;
    document.getElementById('date').value = t.date.split('T')[0];
    document.getElementById('category').value = t.category_id || '';
    
    if(document.getElementById('account')) document.getElementById('account').value = t.account_id || '';

    setType(t.type);

    const paymentSelect = document.getElementById('transaction-payment-method');
    
    if (t.credit_card_id || t.payment_method === 'credit_card') {
        paymentSelect.value = 'credit_card';
        paymentSelect.dispatchEvent(new Event('change'));
        await loadCardOptions(); 
        const cardInput = document.getElementById('transaction-card-input');
        if(cardInput) cardInput.value = t.credit_card_id;
    } else {
        paymentSelect.value = 'debit';
        paymentSelect.dispatchEvent(new Event('change'));
    }

    document.getElementById('check-paid').checked = t.is_paid;
    document.getElementById('check-fixed').checked = t.is_fixed;
}

// --- SISTEMA DE EXCLUSÃO INTELIGENTE ---
window.removeTrans = (id) => {
    // 1. Guarda o ID que queremos apagar
    pendingDeleteId = id;
    
    // 2. Busca os dados da transação para personalizar a mensagem
    const t = globalTransactions.find(tr => tr.id == id);
    
    if (t) {
        const msgElement = document.getElementById('delete-msg');
        // Se for fixa ou parcelada, sugere apagar todas
        if (t.is_fixed || (t.description.includes('/') && t.payment_method === 'credit_card')) {
            msgElement.innerText = `"${t.description}" parece ser uma transação recorrente ou parcelada.`;
            document.querySelector("button[onclick=\"executeDelete('all')\"]").classList.remove('hidden');
        } else {
            // Se for comum, esconde o botão "Excluir Todas" para não confundir (opcional, ou mantém para limpar duplicatas)
            msgElement.innerText = `Deseja realmente excluir "${t.description}"?`;
        }
    }

    // 3. Abre o modal novo
    window.showModal('modal-delete');
}

window.closeDeleteModal = () => {
    pendingDeleteId = null;
    window.hideModal('modal-delete');
}

window.executeDelete = async (mode) => {
    if (!pendingDeleteId) return;

    const t = globalTransactions.find(tr => tr.id == pendingDeleteId);
    if (!t) return;

    try {
        if (mode === 'single') {
            // MODO 1: Apaga só a selecionada (Padrão)
            await supabaseClient.from('transactions').delete().eq('id', pendingDeleteId);
        } 
        else if (mode === 'all') {
            // MODO 2: Apaga TODAS as "gêmeas" (Mesma descrição, valor e tipo)
            // Isso limpa a série inteira (passado e futuro)
            const { error } = await supabaseClient
                .from('transactions')
                .delete()
                .eq('user_id', t.user_id)
                .eq('description', t.description)
                .eq('amount', t.amount) // Garante que não apaga outra coisa com mesmo nome mas valor diferente
                .eq('type', t.type);
                
            if (error) throw error;
        }

        // Atualiza a tela
        fetchTransactions();
        // Se for cartão, atualiza limite também
        if (t.payment_method === 'credit_card') fetchCards();
        
    } catch (error) {
        alert("Erro ao excluir: " + error.message);
    } finally {
        closeDeleteModal();
    }
}

// ==========================================
// 5. CARTÕES (SISTEMA CORRIGIDO)
// ==========================================

// Abrir Modal de Cartão
window.openCardModal = function() {
    console.log("Clicou em Novo Cartão");
    editingCardId = null;
    const form = document.getElementById('form-card');
    if(form) form.reset();
    
    // Abre o modal de CARTÃO (ID correto)
    window.showModal('modal-card-overlay');
}

// Fechar Modal de Cartão
window.closeCardModal = function() {
    window.hideModal('modal-card-overlay');
}

// Editar Cartão
window.prepareEditCard = function(id) {
    console.log("Editando cartão ID:", id);
    const card = globalCards.find(c => c.id == id);
    if (!card) return alert("Erro: Cartão não encontrado.");
    
    editingCardId = id;
    document.getElementById('card_name').value = card.name;
    
    let val = card.limit_amount || card.limit || 0;
    if(typeof val === 'string') val = parseFloat(val.replace(/\./g, '').replace(',', '.'));
    document.getElementById('card_limit').value = val.toLocaleString('pt-br', {minimumFractionDigits: 2});
    
    document.getElementById('card_close').value = card.closing_day || 1;
    document.getElementById('card_due').value = card.due_day || 10;
    
    // Abre o modal de CARTÃO
    window.showModal('modal-card-overlay');
}

// Listar Cartões
async function fetchCards() {
    try {
        const { data: { user } } = await supabaseClient.auth.getUser()
        const year = currentDashboardDate.getFullYear(), month = currentDashboardDate.getMonth()
        
        const { data: cards } = await supabaseClient.from('credit_cards').select('*').eq('user_id', user.id)
        const { data: expenses } = await supabaseClient.from('transactions').select('*').eq('user_id', user.id).eq('payment_method', 'credit_card')
        
        const safeExpenses = expenses || [];
        globalCards = cards || [];
        
        const grid = document.getElementById('cards-grid');
        if(!grid) return;

        if(!cards || cards.length === 0) { 
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; color:#94a3b8; margin-top:20px">Nenhum cartão cadastrado.</p>'; 
            return 
        }

        let htmlContent = '';
        cards.forEach(card => {
            const totalUsed = safeExpenses.filter(t => t.credit_card_id === card.id).reduce((acc, t) => acc + Number(t.amount), 0)
            const limit = safeNumber(card.limit_amount || card.limit);
            
            const available = limit - totalUsed;
            const percent = limit > 0 ? Math.min((totalUsed/limit)*100, 100) : 0
            
            const monthExpenses = safeExpenses.filter(t => { 
                const d=new Date(t.date+'T00:00:00'); 
                return t.credit_card_id === card.id && d.getMonth() === month && d.getFullYear() === year 
            }).sort((a,b) => new Date(b.date) - new Date(a.date))
            
            const invoiceTotal = monthExpenses.reduce((acc, t) => acc + Number(t.amount), 0)
            
            let itemsHTML = ''; 
            monthExpenses.forEach(item => { 
                itemsHTML += `<div class="invoice-item"><div><span class="inv-date">${new Date(item.date).getDate()}</span><strong>${item.description}</strong></div><b>R$ ${item.amount.toLocaleString('pt-br',{minimumFractionDigits:2})}</b></div>` 
            })
            if(itemsHTML === '') itemsHTML = '<div style="padding:10px; text-align:center; color:#ccc; font-size:0.8rem">Sem gastos este mês</div>';

            let bg = 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'; 
            if(card.name.toLowerCase().includes('nu')) bg = 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)'; 

            htmlContent += `
            <div class="card-wrapper">
                <div class="credit-card" style="background:${bg}">
                    <div style="display:flex;justify-content:space-between">
                        <h3>${card.name}</h3>
                        <div class="card-actions">
                            <button class="card-action-btn" onclick="prepareEditCard('${card.id}')"><i class="fa-solid fa-pen"></i></button>
                            <button class="card-action-btn" onclick="removeCard('${card.id}')"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                    <div>
                        <h2 style="font-size:1.8rem">R$ ${invoiceTotal.toLocaleString('pt-br',{minimumFractionDigits:2})}</h2>
                        <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:5px; opacity:0.8">
                            <span>Fatura Atual</span>
                            <span>Disp: ${available.toLocaleString('pt-br',{minimumFractionDigits:2})}</span>
                        </div>
                        <div class="limit-bar"><div class="limit-fill" style="width:${percent}%;background:white"></div></div>
                    </div>
                </div>
                <div class="card-invoice-section">
                    <h5 style="margin-bottom:10px; color:#64748b; font-size:0.8rem; text-transform:uppercase">Extrato Mensal</h5>
                    <div class="invoice-list">${itemsHTML}</div>
                </div>
            </div>`
        })
        grid.innerHTML = htmlContent;

    } catch (e) { console.error("Erro Cartões:", e); }
}

// Salvar Cartão
document.getElementById('form-card').addEventListener('submit', async(e)=>{
    e.preventDefault(); 
    const user=(await supabaseClient.auth.getUser()).data.user; 
    const data={
        name:document.getElementById('card_name').value, 
        limit_amount:parseFloat(document.getElementById('card_limit').value.replace(/\./g, '').replace(',', '.')), 
        closing_day:document.getElementById('card_close').value, 
        due_day:document.getElementById('card_due').value, 
        user_id:user.id
    }; 
    if(editingCardId) await supabaseClient.from('credit_cards').update(data).eq('id',editingCardId); 
    else await supabaseClient.from('credit_cards').insert([data]); 
    
    window.hideModal('modal-card-overlay'); fetchCards();
})

window.removeCard=async(id)=>{ if(confirm('Apagar cartão?')){ await supabaseClient.from('credit_cards').delete().eq('id',id); fetchCards(); } }


// ==========================================
// 6. CONTAS
// ==========================================
async function updateAccountsWidget(userId) {
    const list = document.getElementById('accounts-list-widget')
    if(!list) return

    const { data: accs } = await supabaseClient.from('accounts').select('*').eq('user_id', userId).neq('type', 'investment')
    globalAccounts = accs || [];

    const { data: transactions } = await supabaseClient.from('transactions').select('amount, type, account_id, is_paid').eq('user_id', userId).eq('is_paid', true)
    
    list.innerHTML = ''
    let totalGlobal = 0
    
    if(!accs || accs.length === 0) {
        list.innerHTML = '<div style="padding:10px; color:#9ca3af; font-size:0.9rem">Nenhuma conta.</div>'
    } else {
        accs.forEach(acc => {
            const accountMoves = transactions.filter(t => t.account_id === acc.id);
            const totalIncome = accountMoves.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
            const totalExpense = accountMoves.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
            const currentBalance = acc.initial_balance + totalIncome - totalExpense;
            totalGlobal += currentBalance

            let color = '#94a3b8'; let icon = 'fa-wallet';
            const n = acc.name.toLowerCase()
            if(n.includes('nu')) { color='#8b5cf6'; icon='fa-building-columns' } 
            
            list.innerHTML += `
                <div class="account-item">
                    <div style="display:flex; align-items:center; gap:12px">
                        <div class="acc-icon" style="background:${color}"><i class="fa-solid ${icon}"></i></div>
                        <div><strong style="display:block; font-size:0.9rem">${acc.name}</strong></div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-weight:700; font-size:0.95rem;">R$ ${currentBalance.toLocaleString('pt-br',{minimumFractionDigits:2})}</div>
                        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:4px">
                            <button onclick="prepareEditAccount('${acc.id}')" style="border:none; background:none; color:#94a3b8; cursor:pointer;"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="removeAccount('${acc.id}')" style="border:none; background:none; color:#ef4444; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                </div>`
        })
    }
    document.getElementById('total-accounts-balance').innerText = `R$ ${totalGlobal.toLocaleString('pt-br',{minimumFractionDigits:2})}`
}

window.prepareEditAccount = (id) => {
    const acc = globalAccounts.find(x => x.id == id); 
    if (!acc) return alert("Conta não encontrada."); 
    editingAccountId = id; 
    document.getElementById('acc_name').value = acc.name; 
    document.getElementById('acc_balance').value = acc.initial_balance.toLocaleString('pt-br', {minimumFractionDigits: 2}); 
    window.showModal('modal-account-overlay'); 
}
window.openAccountModal = () => { editingAccountId = null; document.getElementById('form-account').reset(); window.showModal('modal-account-overlay'); }
window.closeAccountModal = () => { window.hideModal('modal-account-overlay'); }

document.getElementById('form-account').addEventListener('submit', async (e) => {
    e.preventDefault(); 
    const user = (await supabaseClient.auth.getUser()).data.user; 
    const name = document.getElementById('acc_name').value; 
    const balance = parseFloat(document.getElementById('acc_balance').value.replace(/\./g, '').replace(',', '.'));
    
    if (editingAccountId) await supabaseClient.from('accounts').update({ name: name, initial_balance: balance }).eq('id', editingAccountId);
    else await supabaseClient.from('accounts').insert([{ name: name, initial_balance: balance, type: 'wallet', user_id: user.id }]);
    
    window.hideModal('modal-account-overlay'); updateAccountsWidget(user.id); loadDropdowns(user.id);
});
window.removeAccount = async (id) => { if (confirm('Excluir conta?')) { await supabaseClient.from('accounts').delete().eq('id', id); const user = (await supabaseClient.auth.getUser()).data.user; updateAccountsWidget(user.id); } }


// ==========================================
// 7. HELPERS, MODAIS E GRÁFICOS
// ==========================================
window.setType = (type) => {
    document.getElementById('type').value = type;
    const btnExp = document.getElementById('btn-type-expense'); const btnInc = document.getElementById('btn-type-income');
    if (type === 'expense') { btnExp.classList.add('active-expense'); btnInc.classList.remove('active-income'); } 
    else { btnExp.classList.remove('active-expense'); btnInc.classList.add('active-income'); }
}

async function loadCardOptions() {
    const targetSelect = document.getElementById('transaction-card-input');
    if (!targetSelect) return;

    targetSelect.innerHTML = '<option value="">Buscando limites...</option>';

    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        
        const { data: cards } = await supabaseClient.from('credit_cards').select('*').eq('user_id', user.id);
        const { data: expenses } = await supabaseClient.from('transactions')
            .select('amount, credit_card_id')
            .eq('user_id', user.id)
            .eq('payment_method', 'credit_card'); 

        targetSelect.innerHTML = '<option value="">Selecione o cartão...</option>';

        if (cards && cards.length > 0) {
            cards.forEach(card => {
                const option = document.createElement('option');
                option.value = card.id;
                
                const limit = safeNumber(card.limit_amount || card.limit);
                const used = (expenses || [])
                    .filter(e => e.credit_card_id === card.id)
                    .reduce((sum, e) => sum + e.amount, 0);

                const available = limit - used;

                option.innerText = `${card.name} (Disp: R$ ${available.toLocaleString('pt-BR', {minimumFractionDigits:2})})`;
                targetSelect.appendChild(option);
            });
        } else {
            targetSelect.innerHTML = '<option value="">Nenhum cartão cadastrado</option>';
        }

    } catch (e) {
        console.error("Erro ao carregar lista de cartões:", e);
    }
}


function setupEventListeners() {
    const payMethod = document.getElementById('transaction-payment-method');
    const cardContainer = document.getElementById('card-select-container');
    const installWrapper = document.getElementById('installments-wrapper');
    
    // Pegamos o campo "Select" da conta e o campo do cartão
    const accountSelect = document.getElementById('account'); 
    const accountDiv = accountSelect?.parentElement; 
    const cardSelect = document.getElementById('transaction-card-input');

    if(payMethod) {
        payMethod.addEventListener('change', (e) => {
            if(e.target.value === 'credit_card') {
                // Modo Cartão: Mostra cartão, esconde conta
                if(cardContainer) cardContainer.classList.remove('hidden');
                if(installWrapper) installWrapper.classList.remove('hidden');
                if(accountDiv) accountDiv.classList.add('hidden');
                
                // CORREÇÃO: Tira a obrigatoriedade da Conta e coloca no Cartão
                if(accountSelect) accountSelect.removeAttribute('required');
                if(cardSelect) cardSelect.setAttribute('required', 'true');

                loadCardOptions();
            } else {
                // Modo Normal: Mostra conta, esconde cartão
                if(cardContainer) cardContainer.classList.add('hidden');
                if(installWrapper) installWrapper.classList.add('hidden');
                if(accountDiv) accountDiv.classList.remove('hidden');
                
                // CORREÇÃO: Devolve a obrigatoriedade para a Conta
                if(accountSelect) accountSelect.setAttribute('required', 'true');
                if(cardSelect) cardSelect.removeAttribute('required');

                document.getElementById('check-installments').checked = false;
                toggleInstallmentInput();
            }
        });
    }
}

window.toggleInstallmentInput = () => {
    const check = document.getElementById('check-installments');
    const input = document.getElementById('installments-count');
    if (check && check.checked) { input.classList.remove('hidden'); input.focus(); } 
    else { input.classList.add('hidden'); input.value = ''; }
}

async function loadDropdowns(uid) {
    let {data:cats} = await supabaseClient.from('categories').select('*').or(`user_id.eq.${uid},is_default.eq.true`);
    let {data:accs} = await supabaseClient.from('accounts').select('*').eq('user_id',uid).neq('type','investment');
    if(accs.length === 0) { accs = (await supabaseClient.from('accounts').insert([{name:'Carteira',type:'wallet',user_id:uid}]).select()).data; }
    const fill = (id, list) => { const el = document.getElementById(id); if(!el) return; el.innerHTML = ''; list.forEach(x => el.innerHTML += `<option value="${x.id}">${x.name}</option>`); };
    fill('category', cats); fill('goal_category', cats); fill('account', accs);
}

// GRÁFICOS
function renderExpenseChart(cats) {
    const ctx = document.getElementById('expenseChart'); 
    if(!ctx) return; 
    
    if(myChart) myChart.destroy();
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#f1f5f9' : '#1e293b';
    
    myChart = new Chart(ctx, { 
        type: 'doughnut', 
        data: { 
            labels: Object.keys(cats), 
            datasets: [{ 
                data: Object.values(cats), 
                backgroundColor: ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'], 
                borderWidth: 0, 
                hoverOffset: 4 
            }] 
        }, 
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            cutout: '75%', 
            // --- ATUALIZAÇÃO: Deixa a troca de mês instantânea ---
            animation: {
                duration: 0 
            },
            // ----------------------------------------------------
            layout: {
                padding: { top: 10, bottom: 20, left: 10, right: 10 }
            },
            plugins: { 
                legend: { 
                    position: 'right', 
                    labels: { boxWidth: 12, usePointStyle: true, color: textColor, padding: 15, font: { size: 11 } } 
                },
                tooltip: {
                    backgroundColor: isDark ? '#1e293b' : '#ffffff',
                    titleColor: isDark ? '#ffffff' : '#1e293b',
                    bodyColor: isDark ? '#cbd5e1' : '#64748b',
                    borderColor: isDark ? '#334155' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8,
                    displayColors: true
                }
            } 
        } 
    })
}

async function renderInvestmentChart(userId) {
    const ctx = document.getElementById('investmentChart'); 
    if(!ctx) return;
    
    // Configurações de cores baseadas no tema
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'; 
    const textColor = isDark ? '#94a3b8' : '#64748b'; 
    const gridColor = isDark ? '#334155' : '#f1f5f9';
    
    const { data: history } = await supabaseClient.from('asset_history').select('reference_date, amount').eq('user_id', userId).order('reference_date', { ascending: true })
    
    const grouped = {}; 
    if(!history || history.length === 0) {
        const { data: accs } = await supabaseClient.from('accounts').select('initial_balance').eq('user_id', userId).eq('type', 'investment'); 
        const labelHoje = new Date().toLocaleDateString('pt-BR', {month:'short', year:'2-digit'});
        grouped[labelHoje] = accs.reduce((a,b) => a + b.initial_balance, 0)
    } else { 
        history.forEach(h => { 
            const l = new Date(h.reference_date).toLocaleDateString('pt-BR', {month:'short', year:'2-digit'}); 
            grouped[l] = (grouped[l]||0)+h.amount 
        }) 
    }
    
    if(investmentChart) investmentChart.destroy();
    
    investmentChart = new Chart(ctx, { 
        type: 'line', 
        data: { 
            labels: Object.keys(grouped), 
            datasets: [{ 
                label: 'Patrimônio', 
                data: Object.values(grouped), 
                borderColor: '#10b981', 
                backgroundColor: 'rgba(16, 185, 129, 0.1)', 
                borderWidth: 3, 
                tension: 0.4, 
                fill: true, 
                pointRadius: 6, 
                pointHoverRadius: 8 
            }] 
        }, 
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            layout: { 
                // AQUI ESTÁ O SEGREDO PARA NÃO CORTAR O GRÁFICO
                padding: { left: 10, right: 25, top: 20, bottom: 10 } 
            }, 
            plugins: { 
                legend: { display: false } 
            }, 
            scales: { 
                y: { 
                    beginAtZero: true, 
                    grid: { color: gridColor }, 
                    ticks: { color: textColor } 
                }, 
                x: { 
                    offset: true, 
                    grid: { display: false }, 
                    ticks: { color: textColor } 
                } 
            } 
        } 
    })
}

// RESTANTE (Investimentos, Categorias, Metas)

async function fetchInvestments() {
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        
        // 1. Pega os dados básicos da conta (Nome, Tipo)
        const { data: accs } = await supabaseClient
            .from('accounts')
            .select('*')
            .eq('user_id', user.id)
            .eq('type', 'investment');

        // 2. Define a data do mês que estamos OLHANDO no painel
        const year = currentDashboardDate.getFullYear();
        const month = currentDashboardDate.getMonth() + 1; // JS é 0-11, banco é 1-12
        // Formato YYYY-MM-01
        const targetDate = `${year}-${String(month).padStart(2,'0')}-01`;

        // 3. Busca o histórico EXATO deste mês
        const { data: history } = await supabaseClient
            .from('asset_history')
            .select('account_id, amount')
            .eq('user_id', user.id)
            .eq('reference_date', targetDate);

        const grid = document.getElementById('investments-grid');
        if(!grid) return;
        
        grid.innerHTML = ''; 
        globalInvestments = accs || [];

        if(!accs || accs.length === 0) {
            grid.innerHTML = '<p style="text-align:center; width:100%; color:#94a3b8; margin-top:20px;">Nenhum investimento.</p>';
            return;
        }

        accs.forEach(acc => {
            // Tenta achar o valor no histórico deste mês
            const historyItem = history ? history.find(h => h.account_id === acc.id) : null;
            
            // Se tiver histórico no mês, usa. Se não, assume 0 (pendente de atualização)
            const displayValue = historyItem ? historyItem.amount : 0;

            // Formatação Visual (Igual ao anterior)
            let type = 'Renda Fixa';
            if(acc.name.includes('|')) type = acc.name.split('|')[0].trim();
            const cleanName = acc.name.includes('|') ? acc.name.split('|')[1].trim() : acc.name;
            
            let icon = 'fa-chart-pie'; 
            let bgClass = 'bg-fixed';
            if(type.includes('Cripto')) { icon = 'fa-bitcoin'; bgClass = 'bg-crypto'; }
            if(type.includes('Ações')) { icon = 'fa-arrow-trend-up'; bgClass = 'bg-stock'; }
            if(type.includes('Reserva')) { icon = 'fa-shield-heart'; bgClass = 'bg-reserva'; }

            // Botão de editar leva o valor que está na tela
            grid.innerHTML += `
            <div class="invest-card">
                <div style="display:flex; justify-content:space-between; align-items:start">
                    <div class="invest-icon ${bgClass}"><i class="fa-solid ${icon}"></i></div>
                    <div class="action-buttons">
                        <button class="action-btn" onclick="prepareEditInv('${acc.id}', ${displayValue}, '${cleanName}')"><i class="fa-solid fa-pen"></i></button>
                        <button class="action-btn delete" onclick="removeInv('${acc.id}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div>
                    <small style="color:var(--text-muted); text-transform:uppercase; font-size:0.75rem; font-weight:600">${type}</small>
                    <h2 class="invest-value">R$ ${displayValue.toLocaleString('pt-br',{minimumFractionDigits:2})}</h2>
                    <div style="font-size:0.9rem; color:#64748b;">${cleanName}</div>
                    ${!historyItem ? '<small style="color:#f59e0b; font-size:0.7rem"><i class="fa-solid fa-triangle-exclamation"></i> Sem registro este mês</small>' : ''}
                </div>
            </div>`;
        });

    } catch(e) { console.error(e); }
}
window.openInvestmentModal=()=>{editingInvestmentId=null;document.getElementById('form-investment').reset();window.showModal('modal-investment-overlay')}; window.closeInvestmentModal=()=>window.hideModal('modal-investment-overlay')
window.prepareEditInv = (id, val, name) => { editingInvestmentId = id; const acc = globalInvestments.find(x => x.id == id); let type = 'Renda Fixa'; if(acc.name.includes('|')) type = acc.name.split('|')[0].trim(); document.getElementById('inv_name').value=name; document.getElementById('inv_type').value=type; document.getElementById('inv_balance').value=val.toLocaleString('pt-br', {minimumFractionDigits: 2}); window.showModal('modal-investment-overlay') }
document.getElementById('form-investment').addEventListener('submit', async(e) => { 
    e.preventDefault(); 
    const {data:{user}} = await supabaseClient.auth.getUser(); 
    
    const type = document.getElementById('inv_type').value; 
    const rawName = document.getElementById('inv_name').value; 
    // Limpeza de valor segura
    const balanceVal = document.getElementById('inv_balance').value;
    const balance = parseFloat(balanceVal.replace(/\./g, '').replace(',', '.'));
    
    const fullName = `${type} | ${rawName}`; 
    
    // Data de Referência: Sempre o dia 01 do mês que está NO DASHBOARD
    const refDate = `${currentDashboardDate.getFullYear()}-${String(currentDashboardDate.getMonth()+1).padStart(2,'0')}-01`; 

    if(!editingInvestmentId){ 
        // CRIAR NOVO
        const{data, error} = await supabaseClient.from('accounts')
            .insert([{name:fullName, type:'investment', initial_balance:balance, user_id:user.id}])
            .select(); 
        
        if(error){ alert("Erro: "+error.message); return; } 
        
        // Cria histórico para o mês atual
        await supabaseClient.from('asset_history').insert([{
            account_id: data[0].id,
            user_id: user.id,
            amount: balance,
            reference_date: refDate
        }]);

    } else { 
        // EDITAR EXISTENTE
        
        // 1. Atualiza o nome na conta principal (se mudou)
        await supabaseClient.from('accounts')
            .update({ name:fullName }) // Não atualizamos o saldo aqui para não quebrar a lógica de histórico
            .eq('id', editingInvestmentId); 
        
        // 2. Salva/Atualiza o histórico DO MÊS SELECIONADO
        await supabaseClient.from('asset_history').upsert([{
            account_id: editingInvestmentId,
            user_id: user.id,
            amount: balance,
            reference_date: refDate
        }], { onConflict: 'account_id, reference_date' });
    } 
    
    window.hideModal('modal-investment-overlay'); 
    fetchInvestments(); 
    renderInvestmentChart(user.id);
});
window.removeInv=async(id)=>{if(confirm('Apagar?')){await supabaseClient.from('accounts').delete().eq('id',id); fetchInvestments()}}
window.openCategoryModal=()=>{editingCategoryId=null;document.getElementById('form-category').reset();window.showModal('modal-category-overlay')}; window.closeCategoryModal=()=>window.hideModal('modal-category-overlay')
document.getElementById('form-category').addEventListener('submit', async(e)=>{ e.preventDefault(); const user=(await supabaseClient.auth.getUser()).data.user; const data={name:document.getElementById('cat_name').value, icon:document.getElementById('cat_icon').value, user_id:user.id, is_default:false, type:'expense'}; if(editingCategoryId) await supabaseClient.from('categories').update(data).eq('id',editingCategoryId); else await supabaseClient.from('categories').insert([data]); window.hideModal('modal-category-overlay'); fetchCategories(); loadDropdowns(user.id) })
window.removeCat=async(id)=>{if(confirm('Apagar?')){const{error}=await supabaseClient.from('categories').delete().eq('id',id); if(error)alert("Em uso."); else fetchCategories()}}
async function fetchCategories() { 
    const { data: { user } } = await supabaseClient.auth.getUser(); 
    const { data: cats } = await supabaseClient.from('categories').select('*').or(`user_id.eq.${user.id},is_default.eq.true`); 
    
    globalCategories = cats; // Salva na memória para podermos editar
    const grid = document.getElementById('categories-list'); 
    grid.innerHTML = ''; 
    
    cats.forEach(c => { 
        // Lógica: Se for padrão (cadeado), não tem botões. Se for sua, tem Editar e Excluir.
        const btns = c.is_default 
            ? '' 
            : `<div class="action-buttons">
                 <button class="action-btn" onclick="prepareEditCategory('${c.id}')"><i class="fa-solid fa-pen"></i></button>
                 <button class="action-btn delete" onclick="removeCat(${c.id})"><i class="fa-solid fa-trash"></i></button>
               </div>`; 
        
        grid.innerHTML += `
        <div class="category-card">
            <div style="display:flex;align-items:center;gap:12px">
                <div style="background:#f1f5f9;color:var(--primary);width:35px;height:35px;display:flex;align-items:center;justify-content:center;border-radius:8px">
                    <i class="fa-solid ${c.icon||'fa-tag'}"></i>
                </div>
                <strong>${c.name}</strong>
            </div>
            ${btns}
        </div>` 
    }) 
}
window.prepareEditCategory = (id) => {
    // Busca os dados da categoria clicada
    const cat = globalCategories.find(c => c.id == id);
    if(!cat) return;

    editingCategoryId = id; // Marca que estamos editando
    
    // Preenche o formulário
    document.getElementById('cat_name').value = cat.name;
    document.getElementById('cat_icon').value = cat.icon || 'fa-tag';
    
    // Abre o modal
    window.showModal('modal-category-overlay');
}
window.openGoalModal=async()=>{document.getElementById('form-goal').reset(); const user=(await supabaseClient.auth.getUser()).data.user; const {data:cats}=await supabaseClient.from('categories').select('*').or(`user_id.eq.${user.id},is_default.eq.true`); const sel=document.getElementById('goal_category'); sel.innerHTML=''; cats.forEach(c=>sel.innerHTML+=`<option value="${c.id}">${c.name}</option>`); window.showModal('modal-goal-overlay')}
window.closeGoalModal=()=>window.hideModal('modal-goal-overlay')
document.getElementById('form-goal').addEventListener('submit', async(e)=>{ e.preventDefault(); const user=(await supabaseClient.auth.getUser()).data.user; const catId=document.getElementById('goal_category').value; const amount=parseFloat(document.getElementById('goal_amount').value.replace(/\./g, '').replace(',', '.')); await supabaseClient.from('goals').delete().eq('user_id',user.id).eq('category_id',catId); await supabaseClient.from('goals').insert([{user_id:user.id, category_id:catId, target_amount:amount}]); window.hideModal('modal-goal-overlay'); fetchGoals(user.id) })
async function fetchGoals(userId) { 
    const list = document.getElementById('goals-list-widget'); 
    if(!list) return; 
    
    const { data: goals } = await supabaseClient.from('goals').select(`*, categories(name)`).eq('user_id', userId); 
    
    if(!goals || goals.length === 0) { 
        list.innerHTML = '<small style="color:#94a3b8">Nenhuma meta definida.</small>'; 
        return; 
    } 
    
    const year = currentDashboardDate.getFullYear(); 
    const month = currentDashboardDate.getMonth(); 
    const start = new Date(year, month, 1).toISOString(); 
    const end = new Date(year, month + 1, 0).toISOString(); 
    
    const { data: expenses } = await supabaseClient.from('transactions').select('amount, category_id').eq('user_id', userId).eq('type', 'expense').gte('date', start).lte('date', end); 
    
    list.innerHTML = ''; 
    
    goals.forEach(g => { 
        const spent = expenses.filter(e => e.category_id === g.category_id).reduce((acc, curr) => acc + curr.amount, 0); 
        const percent = Math.min((spent / g.target_amount) * 100, 100); 
        let color = '#10b981'; 
        if(percent > 75) color = '#f59e0b'; 
        if(percent >= 100) color = '#ef4444'; 
        
        list.innerHTML += `
        <div class="goal-item" style="margin-bottom:15px">
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; font-weight:700; margin-bottom:5px; color:var(--text-muted)">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span>${g.categories.name}</span>
                    <div style="display:flex; gap:5px; opacity:0.6;">
                        <i class="fa-solid fa-pen" style="cursor:pointer; font-size:0.7rem;" onclick="prepareEditGoal('${g.category_id}', ${g.target_amount})" title="Editar Valor"></i>
                        <i class="fa-solid fa-trash" style="cursor:pointer; color:#ef4444; font-size:0.7rem;" onclick="removeGoal('${g.id}')" title="Excluir Meta"></i>
                    </div>
                </div>
                <span>${Math.round(percent)}%</span>
            </div>
            <div class="progress-bg"><div class="progress-fill" style="width:${percent}%; background:${color}"></div></div>
            <div style="display:flex; justify-content:space-between; font-size:0.7rem; margin-top:3px; color:#94a3b8">
                <span>R$ ${spent.toLocaleString('pt-br')}</span>
                <span>Meta: R$ ${g.target_amount.toLocaleString('pt-br')}</span>
            </div>
        </div>`; 
    }); 
}
window.removeGoal = async (id) => {
    if(confirm('Tem certeza que deseja excluir esta meta?')) {
        const { error } = await supabaseClient.from('goals').delete().eq('id', id);
        if(!error) {
            const user = (await supabaseClient.auth.getUser()).data.user;
            fetchGoals(user.id);
        } else {
            alert("Erro ao excluir: " + error.message);
        }
    }
}
window.prepareEditGoal = (catId, currentAmount) => {
    // Abre o modal já com a categoria e valor selecionados
    document.getElementById('goal_category').value = catId;
    document.getElementById('goal_amount').value = currentAmount.toLocaleString('pt-br', {minimumFractionDigits: 2});
    window.showModal('modal-goal-overlay');
}
async function processFixedExpenses(userId) { 
    const targetDate = new Date(currentDashboardDate); 
    const targetMonth = targetDate.getMonth(), targetYear = targetDate.getFullYear(); 
    
    // Busca todas as fixas do usuário
    const { data: fixedOps } = await supabaseClient.from('transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('is_fixed', true); 

    if (!fixedOps || fixedOps.length === 0) return; 

    for (const op of fixedOps) { 
        const opDate = new Date(op.date + 'T00:00:00'); 
        
        // Se a despesa já é deste mês ou futuro, pula
        if (opDate.getMonth() === targetMonth && opDate.getFullYear() === targetYear) continue; 
        if (opDate > new Date(targetYear, targetMonth + 1, 0)) continue; 

        // Define o intervalo do mês atual para verificar duplicatas
        const startOfMonth = new Date(targetYear, targetMonth, 1).toISOString(); 
        const endOfMonth = new Date(targetYear, targetMonth + 1, 0).toISOString(); 

        // Verifica se já existe uma transação com o MESMO NOME neste mês
        const { data: duplicates } = await supabaseClient.from('transactions')
            .select('id')
            .eq('description', op.description) // A chave é o nome
            .gte('date', startOfMonth)
            .lte('date', endOfMonth); 

        if (duplicates.length === 0) { 
            // Calcula o dia correto (ex: dia 30 em fevereiro vira dia 28)
            const originalDay = opDate.getDate(); 
            const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate(); 
            const newDate = new Date(targetYear, targetMonth, Math.min(originalDay, lastDayOfTargetMonth)); 
            
            // CRIA A CÓPIA
            await supabaseClient.from('transactions').insert([{ 
                description: op.description, 
                amount: op.amount, 
                type: op.type, 
                category_id: op.category_id, 
                account_id: op.account_id, 
                payment_method: op.payment_method, 
                user_id: userId, 
                is_paid: false, // Nasce pendente
                date: newDate.toISOString().split('T')[0], 
                credit_card_id: op.credit_card_id, 
                is_fixed: true // <--- A CORREÇÃO ESTÁ AQUI (Antes estava false)
            }]);
        } 
    } 
}

// ==========================================
// 8. MENU MOBILE (Responsividade)
// ==========================================

window.toggleSidebar = () => {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    // Troca a classe .active (se tem tira, se não tem põe)
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
}

// Fecha o menu se clicar no fundo escuro (Overlay)
document.getElementById('sidebar-overlay').addEventListener('click', () => {
    window.toggleSidebar();
});

// --- MODO PRIVACIDADE (ATUALIZADO) ---
window.togglePrivacy = () => {
    const body = document.body;
    body.classList.toggle('hide-values');
    
    const isHidden = body.classList.contains('hide-values');
    localStorage.setItem('privacyMode', isHidden ? 'hidden' : 'visible');
    
    updatePrivacyUI(isHidden);
}

function updatePrivacyUI(isHidden) {
    // Agora buscamos o ícone pelo NOVO ID no widget
    const icon = document.getElementById('privacy-icon-widget');
    if(!icon) return;
    
    // Troca apenas o ícone (não tem mais texto)
    if(isHidden) {
        icon.className = 'fa-solid fa-eye-slash';
    } else {
        icon.className = 'fa-solid fa-eye';
    }
}

// Verifica ao carregar a página
if(localStorage.getItem('privacyMode') === 'hidden') {
    document.body.classList.add('hide-values');
    // Pequeno timeout para garantir que o ícone carregou antes de tentar mudar
    setTimeout(() => updatePrivacyUI(true), 100);
}

// --- SISTEMA DE NOTIFICAÇÕES (TOAST) ---
window.showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    
    // Cria o elemento
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Escolhe o ícone baseado no tipo
    let icon = 'fa-circle-check';
    let color = '#10b981'; // Verde
    
    if (type === 'error') { icon = 'fa-circle-xmark'; color = '#ef4444'; }
    if (type === 'info')  { icon = 'fa-circle-info';  color = '#3b82f6'; }

    toast.innerHTML = `
        <i class="fa-solid ${icon}" style="color: ${color}; font-size: 1.2rem;"></i>
        <span>${message}</span>
    `;

    // Adiciona na tela
    container.appendChild(toast);

    // Remove automaticamente depois de 3 segundos
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}




// INICIALIZAÇÃO
setupEventListeners();
checkUser();