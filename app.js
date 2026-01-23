// ================= CONFIGURAÇÕES =================
const supabaseUrl = 'https://dwuaiqfvseridxcadduu.supabase.co' 
const supabaseKey = 'sb_publishable_HX71d-G-UBaRM16Vz0fH4A_ZoF44IEE' 
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey)

let currentDashboardDate = new Date()
let globalTransactions=[], globalCards=[], globalCategories=[], globalInvestments=[]
let editingTransactionId=null, editingCardId=null, editingCategoryId=null, editingInvestmentId=null
let myChart=null, investmentChart=null, allocationChart=null
let isLoading = false // TRAVA CONTRA DUPLO CLIQUE

// ================= LOGIN & AUTH =================
async function checkUser() {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (session) {
        document.getElementById('login-screen').classList.add('hidden')
        document.getElementById('app-layout').classList.remove('hidden')
        document.getElementById('user-email').innerText = session.user.email
        loadDropdowns(session.user.id)
        updateDateDisplay()
        showSection('dashboard')
        // Inicia robô sem travar a tela
        processFixedExpenses(session.user.id)
    } else {
        document.getElementById('login-screen').classList.remove('hidden')
        document.getElementById('app-layout').classList.add('hidden')
    }
}
document.getElementById('btnLogin').addEventListener('click', async () => {
    const email=document.getElementById('email').value, password=document.getElementById('password').value
    const {error}=await supabaseClient.auth.signInWithPassword({email,password})
    if(error) alert(error.message); else checkUser()
})
document.getElementById('btnRegister').addEventListener('click', async () => {
    const email=document.getElementById('email').value, password=document.getElementById('password').value
    const {error}=await supabaseClient.auth.signUp({email,password})
    if(error) alert(error.message); else alert('Verifique seu email!')
})
document.getElementById('btnLogout').addEventListener('click', async () => { await supabaseClient.auth.signOut(); location.reload() })

// ================= NAVEGAÇÃO SEGURA =================
window.showSection = function(id) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'))
    document.getElementById('view-'+id).classList.remove('hidden')
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'))
    
    const activeBtn = document.querySelector(`.nav-item[onclick="showSection('${id}')"]`)
    if(activeBtn) activeBtn.classList.add('active')
    
    const btn = document.getElementById('global-btn')
    if(id === 'dashboard' || id === 'transactions') btn.classList.remove('hidden'); else btn.classList.add('hidden')

    const titles = {'dashboard':'Visão Geral','transactions':'Extrato','cards':'Meus Cartões','investments':'Investimentos','categories':'Categorias'}
    document.getElementById('page-title').innerText = titles[id] || 'My Finance'
    
    refreshCurrentView()
}

function refreshCurrentView() {
    if(!document.getElementById('view-transactions').classList.contains('hidden')) {
        fetchTransactions()
    }
    else if(!document.getElementById('view-dashboard').classList.contains('hidden')) {
        fetchTransactions()
    }
    else if(!document.getElementById('view-cards').classList.contains('hidden')) {
        fetchCards()
    }
    else if(!document.getElementById('view-investments').classList.contains('hidden')) {
        fetchInvestments()
    }
    else if(!document.getElementById('view-categories').classList.contains('hidden')) {
        fetchCategories() // <--- AGORA SIM! ELE VAI CARREGAR AS CATEGORIAS
    }
}

function updateDateDisplay() {
    const text = currentDashboardDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase()
    const ids = ['current-month-display', 'current-month-display-extrato', 'current-month-display-cards', 'current-month-display-invest']
    ids.forEach(id => { const el = document.getElementById(id); if(el) el.innerText = text; })
}

// MUDANÇA DE MÊS COM PROTEÇÃO
window.changeMonth = async function(step) {
    if(isLoading) return; // Impede clique duplo rápido
    isLoading = true;

    currentDashboardDate.setMonth(currentDashboardDate.getMonth() + step)
    updateDateDisplay()
    
    const { data: { user } } = await supabaseClient.auth.getUser()
    if(user) await processFixedExpenses(user.id)

    await refreshCurrentView()
    
    setTimeout(() => { isLoading = false }, 300); // Destrava após 300ms
}

// ================= INVESTIMENTOS (CORRIGIDO) =================
async function fetchInvestments() {
    console.log("🔄 Buscando Investimentos para:", currentDashboardDate.toLocaleDateString());
    const { data: { user } } = await supabaseClient.auth.getUser()
    
    // DATA LIMITE (Fim do mês visualizado)
    const year = currentDashboardDate.getFullYear()
    const month = currentDashboardDate.getMonth() + 1
    const lastDay = new Date(year, month, 0).getDate()
    const compareString = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    
    // 1. Busca Contas
    const { data: accs } = await supabaseClient.from('accounts').select('*').eq('user_id', user.id).eq('type', 'investment')
    
    // 2. Busca Histórico Total (Ordenado)
    const { data: history } = await supabaseClient.from('asset_history').select('*').eq('user_id', user.id).order('reference_date', { ascending: false })
    const safeHistory = history || [] 

    const grid = document.getElementById('investments-grid')
    if(!grid) return
    grid.innerHTML = ''
    globalInvestments = accs // Guarda referência das contas
    
    let total = 0
    let allocation = {}

    accs.forEach(acc => {
        // LÓGICA DE HISTÓRICO
        const validEntry = safeHistory.find(h => h.account_id == acc.id && h.reference_date <= compareString)
        
        let currentBalance = 0
        if (validEntry) {
            currentBalance = Number(validEntry.amount) // Usa histórico encontrado
        } else {
            // Se estamos no futuro ou presente, usa o saldo atual. Se passado sem histórico, 0.
            const todayStr = new Date().toISOString().split('T')[0]
            if (compareString >= todayStr) currentBalance = Number(acc.initial_balance)
            else currentBalance = 0 
        }
        
        total += currentBalance

        // Visual
        let type = "Geral"
        if(acc.name.includes('|')) type = acc.name.split('|')[0].trim()
        if(!allocation[type]) allocation[type] = 0
        allocation[type] += currentBalance

        let icon = 'fa-chart-pie'
        if(type === 'Cripto') icon = 'fa-bitcoin'
        if(type === 'Ações') icon = 'fa-arrow-trend-up'
        if(type === 'Renda Fixa') icon = 'fa-sack-dollar'
        const cleanName = acc.name.includes('|') ? acc.name.split('|')[1].trim() : acc.name

        // --- CORREÇÃO DO BOTÃO EDITAR ---
        // Agora passamos 'currentBalance' e 'cleanName' para a função de editar
        grid.innerHTML += `
            <div class="invest-card">
                <div style="display:flex; justify-content:space-between">
                    <div style="font-size:1.5rem; color:var(--primary); background:#e0f2fe; width:45px; height:45px; display:flex; align-items:center; justify-content:center; border-radius:10px"><i class="fa-solid ${icon}"></i></div>
                    <div class="action-buttons">
                        <button class="action-btn" onclick="prepareEditInv(${acc.id}, ${currentBalance}, '${cleanName}')"><i class="fa-solid fa-pen"></i></button>
                        <button class="action-btn delete" onclick="removeInv(${acc.id})"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div>
                    <h2 style="color:var(--text-main); font-size:1.4rem">R$ ${currentBalance.toLocaleString('pt-br',{minimumFractionDigits:2})}</h2>
                    <small style="color:var(--text-muted); font-size:0.85rem">${cleanName}</small>
                </div>
            </div>
        `
    })
    
    if(document.getElementById('total-invested')) document.getElementById('total-invested').innerText = `R$ ${total.toLocaleString('pt-br',{minimumFractionDigits:2})}`
    if(typeof renderAllocationChart === 'function') renderAllocationChart(allocation)
}

// JANELA DE EDITAR (AGORA RECEBE O VALOR DO MÊS CORRETO)
window.prepareEditInv = (id, val, name) => {
    editingInvestmentId = id;
    const acc = globalInvestments.find(x => x.id == id);
    
    let type = 'Renda Fixa'
    if(acc.name.includes('|')) type = acc.name.split('|')[0].trim();

    setVal('inv_name', name); // Nome limpo
    setVal('inv_type', type);
    setVal('inv_balance', val.toLocaleString('pt-br', {minimumFractionDigits: 2})); // Valor visualizado (Histórico)
    
    open('modal-investment-overlay')
}

// SALVAR INVESTIMENTO (MANTÉM O TIPO CORRETO)
document.getElementById('form-investment').addEventListener('submit', async(e) => {
    e.preventDefault(); 
    const { data: { user } } = await supabaseClient.auth.getUser()
    
    const type = getVal('inv_type')
    const rawName = getVal('inv_name') // Nome sem o tipo
    const balance = parseCurrency(getVal('inv_balance'))
    const fullName = `${type} | ${rawName}` // Reconstrói o nome completo
    
    const year = currentDashboardDate.getFullYear()
    const month = String(currentDashboardDate.getMonth() + 1).padStart(2, '0')
    const refDate = `${year}-${month}-01`

    let accountId = editingInvestmentId
    
    if (!editingInvestmentId) {
        // Nova Conta
        const { data, error } = await supabaseClient.from('accounts').insert([{ name: fullName, type: 'investment', initial_balance: balance, user_id: user.id }]).select()
        if(error) { alert("Erro: " + error.message); return; }
        accountId = data[0].id
        await supabaseClient.from('asset_history').insert([{ account_id: accountId, user_id: user.id, amount: balance, reference_date: refDate }])
    } else {
        // Atualiza Conta
        await supabaseClient.from('accounts').update({ name: fullName, initial_balance: balance }).eq('id', accountId)
        
        // Atualiza Histórico
        const { data: exist } = await supabaseClient.from('asset_history').select('id').eq('account_id', accountId).eq('reference_date', refDate).maybeSingle()
        if(exist) await supabaseClient.from('asset_history').update({ amount: balance }).eq('id', exist.id)
        else await supabaseClient.from('asset_history').insert([{ account_id: accountId, user_id: user.id, amount: balance, reference_date: refDate }])
    }
    
    closeInvestmentModal(); 
    fetchInvestments();
})

// ================= FUNÇÕES DO ROBÔ E FETCHS ANTIGOS (MANTIDOS) =================
async function processFixedExpenses(userId) {
    const targetDate = new Date(currentDashboardDate); // CLONE DA DATA PARA SEGURANÇA
    const targetMonth = targetDate.getMonth()
    const targetYear = targetDate.getFullYear()
    
    const { data: fixedOps } = await supabaseClient.from('transactions').select('*').eq('user_id', userId).eq('is_fixed', true)
    if (!fixedOps || fixedOps.length === 0) return

    for (const op of fixedOps) {
        const opDate = new Date(op.date + 'T00:00:00')
        if (opDate.getMonth() === targetMonth && opDate.getFullYear() === targetYear) continue
        if (opDate > new Date(targetYear, targetMonth + 1, 0)) continue

        const startOfMonth = new Date(targetYear, targetMonth, 1).toISOString()
        const endOfMonth = new Date(targetYear, targetMonth + 1, 0).toISOString()
        const { data: duplicates } = await supabaseClient.from('transactions').select('id').eq('description', op.description).gte('date', startOfMonth).lte('date', endOfMonth)

        if (duplicates.length === 0) {
            const originalDay = opDate.getDate()
            const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate()
            const newDate = new Date(targetYear, targetMonth, Math.min(originalDay, lastDayOfTargetMonth))

            await supabaseClient.from('transactions').insert([{
                description: op.description, amount: op.amount, type: op.type, category_id: op.category_id, 
                account_id: op.account_id, payment_method: op.payment_method, user_id: userId, is_paid: false, 
                date: newDate.toISOString().split('T')[0], credit_card_id: op.credit_card_id, is_fixed: false 
            }])
        }
    }
}

async function fetchTransactions() {
    const { data: { user } } = await supabaseClient.auth.getUser()
    const year = currentDashboardDate.getFullYear(), month = currentDashboardDate.getMonth()
    const start = new Date(year, month, 1).toISOString(), end = new Date(year, month + 1, 0).toISOString()

    // Busca transações
    const { data: trans } = await supabaseClient.from('transactions')
        .select(`*, categories (name)`)
        .eq('user_id', user.id).gte('date', start).lte('date', end)
        .order('date', {ascending: false})
    
    globalTransactions = trans
    
    // Calcula Totais
    let income=0, expense=0, cats={}
    const list = document.getElementById('transactions-full') // Lista do Extrato
    const preview = document.getElementById('transactions-preview') // Lista da Dashboard
    
    if(list) list.innerHTML = ''; 
    if(preview) preview.innerHTML = '';
    
    trans.forEach((t, i) => {
        if(t.is_paid) {
            if(t.type === 'income') income += t.amount
            else {
                expense += t.amount
                const cName = t.categories?.name || 'Outros'
                cats[cName] = (cats[cName] || 0) + t.amount
            }
        }

        // --- GERAÇÃO DO HTML COM BOTÕES ---
        const isInc = t.type === 'income'
        const dateStr = new Date(t.date).toLocaleDateString('pt-BR')
        
        const html = `
        <li style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid #f1f5f9">
            <div>
                <strong>${t.description}</strong><br>
                <small style="color:#94a3b8">${dateStr}</small>
            </div>
            
            <div style="display:flex; align-items:center; gap:15px">
                <div style="font-weight:bold; color:${isInc?'var(--success)':'var(--danger)'}">
                    ${isInc?'+':'-'} R$ ${t.amount.toLocaleString('pt-br',{minimumFractionDigits:2})}
                </div>
                
                <div class="action-buttons">
                    <button class="action-btn" onclick="prepareEdit(${t.id})"><i class="fa-solid fa-pen"></i></button>
                    <button class="action-btn delete" onclick="removeTrans(${t.id})"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        </li>`

        // Adiciona na lista do Extrato
        if(list) list.innerHTML += html
        // Adiciona na Dashboard (só os 5 primeiros)
        if(preview && i < 5) preview.innerHTML += html
    })

    // Atualiza Totais na Tela
    if(document.getElementById('display-income')) document.getElementById('display-income').innerText = `R$ ${income.toLocaleString('pt-br',{minimumFractionDigits:2})}`
    if(document.getElementById('display-expense')) document.getElementById('display-expense').innerText = `R$ ${expense.toLocaleString('pt-br',{minimumFractionDigits:2})}`
    if(document.getElementById('display-total')) document.getElementById('display-total').innerText = `R$ ${(income - expense).toLocaleString('pt-br',{minimumFractionDigits:2})}`

    // Atualiza Gráficos
    renderExpenseChart(cats)
    renderInvestmentChart(user.id)
}

function renderExpenseChart(cats) {
    const ctx = document.getElementById('expenseChart'); if(!ctx) return; if(myChart) myChart.destroy();
    const colors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];
    myChart = new Chart(ctx, { type: 'doughnut', data: { labels: Object.keys(cats), datasets: [{ data: Object.values(cats), backgroundColor: colors, borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position:'right', labels:{boxWidth:12, usePointStyle:true} } } } })
}
async function renderInvestmentChart(userId) {
    const ctx = document.getElementById('investmentChart'); if(!ctx) return;
    const { data: history } = await supabaseClient.from('asset_history').select('reference_date, amount').eq('user_id', userId).order('reference_date', { ascending: true })
    const grouped = {}; 
    if(!history || history.length === 0) {
        const { data: accs } = await supabaseClient.from('accounts').select('initial_balance').eq('user_id', userId).eq('type', 'investment'); 
        grouped[new Date().toLocaleDateString('pt-BR', {month:'short', year:'2-digit'})] = accs.reduce((a,b) => a + b.initial_balance, 0)
    } else { history.forEach(h => { const l = new Date(h.reference_date).toLocaleDateString('pt-BR', {month:'short', year:'2-digit'}); grouped[l] = (grouped[l]||0)+h.amount }) }
    if(investmentChart) investmentChart.destroy();
    investmentChart = new Chart(ctx, { type: 'line', data: { labels: Object.keys(grouped), datasets: [{ label: 'Patrimônio', data: Object.values(grouped), borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 3, tension: 0.4, fill: true, pointRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } } })
}
function renderAllocationChart(dataObj) {
    const ctx = document.getElementById('allocationChart'); if(!ctx) return; if(allocationChart) allocationChart.destroy();
    allocationChart = new Chart(ctx, { type: 'doughnut', data: { labels: Object.keys(dataObj), datasets: [{ data: Object.values(dataObj), backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8 } } } } })
}

// RESTANTE DAS FUNÇÕES (CATEGORIA, CARTÕES, UTILS)
async function fetchCategories() {
    const { data: { user } } = await supabaseClient.auth.getUser()
    const { data: cats } = await supabaseClient.from('categories').select('*').or(`user_id.eq.${user.id},is_default.eq.true`)
    globalCategories = cats; const grid = document.getElementById('categories-list'); grid.innerHTML = ''
    cats.forEach(c => {
        const btns = c.is_default ? '' : `<div class="action-buttons"><button class="action-btn" onclick="prepareEditCat(${c.id})"><i class="fa-solid fa-pen"></i></button><button class="action-btn delete" onclick="removeCat(${c.id})"><i class="fa-solid fa-trash"></i></button></div>`
        grid.innerHTML += `<div class="category-card"><div style="display:flex;align-items:center;gap:12px"><div style="background:#f1f5f9;color:var(--primary);width:35px;height:35px;display:flex;align-items:center;justify-content:center;border-radius:8px"><i class="fa-solid ${c.icon||'fa-tag'}"></i></div><strong>${c.name}</strong></div>${btns}</div>`
    })
}
async function fetchCards() { /* Mesma lógica já corrigida de cartões */
    const { data: { user } } = await supabaseClient.auth.getUser()
    const year = currentDashboardDate.getFullYear(), month = currentDashboardDate.getMonth()
    const { data: cards } = await supabaseClient.from('credit_cards').select('*').eq('user_id', user.id)
    const { data: expenses } = await supabaseClient.from('transactions').select('*').eq('user_id', user.id).eq('payment_method', 'credit_card')
    globalCards = cards; const grid = document.getElementById('cards-grid'); if(grid) grid.innerHTML = ''
    if(cards.length === 0 && grid) { grid.innerHTML = '<p>Nenhum cartão.</p>'; return }
    cards.forEach(card => {
        const totalUsed = expenses.filter(t => t.credit_card_id === card.id).reduce((acc, t) => acc + Number(t.amount), 0)
        const limit = Number(card.limit_amount); const available = limit - totalUsed; const percent = Math.min((totalUsed/limit)*100, 100)
        const monthExpenses = expenses.filter(t => { const d=new Date(t.date+'T00:00:00'); return t.credit_card_id===card.id && d.getMonth()===month && d.getFullYear()===year }).sort((a,b)=>new Date(b.date)-new Date(a.date))
        const invoiceTotal = monthExpenses.reduce((acc, t) => acc + Number(t.amount), 0)
        let itemsHTML = ''; monthExpenses.forEach(item => { itemsHTML += `<div class="invoice-item"><div><span class="inv-date">${new Date(item.date).getDate()}</span><strong>${item.description}</strong></div><b>R$ ${item.amount}</b></div>` })
        let bg = '#1e293b'; if(card.name.toLowerCase().includes('nu')) bg='#8b5cf6'; if(card.name.toLowerCase().includes('inter')) bg='#f97316';
        grid.innerHTML += `<div class="card-wrapper"><div class="credit-card" style="background:${bg}"><div style="display:flex;justify-content:space-between"><h3>${card.name}</h3><div class="card-actions"><button class="card-action-btn" onclick="prepareEditCard(${card.id})"><i class="fa-solid fa-pen"></i></button><button class="card-action-btn" onclick="removeCard(${card.id})"><i class="fa-solid fa-trash"></i></button></div></div><div><h2>R$ ${invoiceTotal.toFixed(2)}</h2><small>Disp: ${available.toFixed(2)}</small><div class="limit-bar"><div class="limit-fill" style="width:${percent}%;background:white"></div></div></div></div><div class="card-invoice-section"><div class="invoice-list">${itemsHTML}</div></div></div>`
    })
}

const getVal=(id)=>document.getElementById(id).value; const setVal=(id,v)=>document.getElementById(id).value=v
const open=(id)=>document.getElementById(id).classList.remove('hidden'); const close=(id)=>document.getElementById(id).classList.add('hidden')
const parseCurrency=(v)=>parseFloat(v.replace(/[^\d,]/g, '').replace(',', '.')||0)
window.openModal=()=>{editingTransactionId=null;document.getElementById('form').reset();open('modal-overlay')}
window.closeModal=()=>close('modal-overlay'); window.openCardModal=()=>{editingCardId=null;document.getElementById('form-card').reset();open('modal-card-overlay')}; window.closeCardModal=()=>close('modal-card-overlay')
window.openInvestmentModal=()=>{editingInvestmentId=null;document.getElementById('form-investment').reset();open('modal-investment-overlay')}; window.closeInvestmentModal=()=>close('modal-investment-overlay')
window.openCategoryModal=()=>{editingCategoryId=null;document.getElementById('form-category').reset();open('modal-category-overlay')}; window.closeCategoryModal=()=>close('modal-category-overlay')
window.prepareEdit=(id)=>{const t=globalTransactions.find(x=>x.id===id); editingTransactionId=id; setVal('description',t.description); setVal('amount',t.amount.toLocaleString('pt-br',{minimumFractionDigits:2})); setVal('type',t.type); setVal('date',t.date); setVal('category',t.category_id); setVal('account',t.account_id); document.getElementById('is_fixed').checked=t.is_fixed; open('modal-overlay')}
window.prepareEditCard=(id)=>{const c=globalCards.find(x=>x.id===id); editingCardId=id; setVal('card_name',c.name); setVal('card_limit',c.limit_amount); open('modal-card-overlay')}
window.prepareEditCat=(id)=>{const c=globalCategories.find(x=>x.id===id); editingCategoryId=id; setVal('cat_name',c.name); open('modal-category-overlay')}
window.removeTrans=async(id)=>{if(confirm('Apagar?')){await supabaseClient.from('transactions').delete().eq('id',id); fetchTransactions()}}
window.removeCard=async(id)=>{if(confirm('Apagar?')){await supabaseClient.from('credit_cards').delete().eq('id',id); fetchCards()}}
window.removeInv=async(id)=>{if(confirm('Apagar?')){await supabaseClient.from('accounts').delete().eq('id',id); fetchInvestments()}}
window.removeCat = async (id) => {
    if (confirm('Tem certeza que deseja apagar esta categoria?')) {
        
        // Tenta apagar
        const { error } = await supabaseClient.from('categories').delete().eq('id', id);

        if (error) {
            // Erro 23503 é o código do banco para "Existe coisa vinculada a isso"
            if (error.code === '23503') {
                alert("🚫 Não foi possível apagar!\n\nEsta categoria está sendo usada em alguma transação (Receita ou Despesa).\n\nApague ou mude a categoria dessas transações antes de excluir a categoria.");
            } else {
                alert("Erro ao apagar: " + error.message);
            }
        } else {
            // Se deu certo, atualiza a tela
            fetchCategories();
            const user = (await supabaseClient.auth.getUser()).data.user
            loadDropdowns(user.id) // Atualiza o select de categorias no modal
        }
    }
}
document.getElementById('form').addEventListener('submit', async(e)=>{e.preventDefault(); const user=(await supabaseClient.auth.getUser()).data.user; const data={description:getVal('description'), amount:parseCurrency(getVal('amount')), type:getVal('type'), date:getVal('date'), category_id:getVal('category'), account_id:getVal('account'), payment_method:getVal('payment_method'), user_id:user.id, is_fixed:document.getElementById('is_fixed').checked, is_paid:document.getElementById('is_paid').checked}; if(editingTransactionId) await supabaseClient.from('transactions').update(data).eq('id',editingTransactionId); else await supabaseClient.from('transactions').insert([data]); closeModal(); fetchTransactions()})
document.getElementById('form-card').addEventListener('submit', async(e)=>{e.preventDefault(); const user=(await supabaseClient.auth.getUser()).data.user; const data={name:getVal('card_name'), limit_amount:parseCurrency(getVal('card_limit')), closing_day:getVal('card_close'), due_day:getVal('card_due'), user_id:user.id}; if(editingCardId) await supabaseClient.from('credit_cards').update(data).eq('id',editingCardId); else await supabaseClient.from('credit_cards').insert([data]); closeCardModal(); fetchCards()})
document.getElementById('form-category').addEventListener('submit', async(e)=>{e.preventDefault(); const user=(await supabaseClient.auth.getUser()).data.user; const data={name:getVal('cat_name'), icon:getVal('cat_icon'), user_id:user.id, is_default:false, type:'expense'}; if(editingCategoryId) await supabaseClient.from('categories').update(data).eq('id',editingCategoryId); else await supabaseClient.from('categories').insert([data]); closeCategoryModal(); fetchCategories(); loadDropdowns(user.id)})
window.toggleCardInput=()=>{if(getVal('payment_method')==='credit_card')document.getElementById('credit_card_options').classList.remove('hidden'); else document.getElementById('credit_card_options').classList.add('hidden')}
window.toggleInstallments=()=>{if(document.getElementById('is_installment').checked)document.getElementById('installments_count').classList.remove('hidden');else document.getElementById('installments_count').classList.add('hidden')}
async function loadDropdowns(uid){let{data:cats}=await supabaseClient.from('categories').select('*').or(`user_id.eq.${uid},is_default.eq.true`);let{data:accs}=await supabaseClient.from('accounts').select('*').eq('user_id',uid).neq('type','investment');let{data:cards}=await supabaseClient.from('credit_cards').select('*').eq('user_id',uid);if(accs.length===0)accs=(await supabaseClient.from('accounts').insert([{name:'Carteira',type:'wallet',user_id:uid}]).select()).data;const fill=(id,l)=>{const e=document.getElementById(id);e.innerHTML='';l.forEach(x=>e.innerHTML+=`<option value="${x.id}">${x.name}</option>`)};fill('category',cats);fill('account',accs);fill('credit_card_select',cards)}

checkUser()