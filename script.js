// Nasconde la pagina finché non sono verificati accesso e permessi
document.documentElement.style.visibility = 'hidden';

// Collegamento a Supabase (la chiave "publishable" è fatta per stare nel codice)
const SUPABASE_URL = 'https://pvlergszyysfwnwxjkje.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9fyhP4IaWZzZW0ZCKRVRIw_4qw3TTxb';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Dati dell'utente (compilati all'avvio)
let utenteId = null;
let nomeUtente = '';
let ruolo = null;
let puoVedereStorico = false;
let puoCancellare = false;

let immagineBase64 = null;
let fotoMotriceBase64 = null;
let fotoRimorchioBase64 = null;
let listaSegnalazioni = [];
let segnalazioneAperta = null;

document.addEventListener('DOMContentLoaded', avvia);

async function avvia() {
    try {
        const { data, error: errSessione } = await db.auth.getSession();
        if (errSessione || !data || !data.session) {
            window.location.href = 'login.html';
            return;
        }
        utenteId = data.session.user.id;

        // Il ruolo viene letto dal database, non da qualcosa che l'utente può modificare
        const { data: profilo, error } = await db
            .from('profili')
            .select('username, ruolo')
            .eq('id', utenteId)
            .single();

        if (error || !profilo) {
            document.documentElement.style.visibility = 'visible';
            alert('Profilo non trovato: ' + (error ? error.message : 'nessuna riga per questo utente'));
            return;
        }

        nomeUtente = profilo.username;
        ruolo = profilo.ruolo;
        puoVedereStorico = ruolo === 'admin' || ruolo === 'visionatore';
        puoCancellare = ruolo === 'admin';

        applicaPermessi();
        if (puoVedereStorico) await caricaSegnalazioni();
        aggiornaInterfaccia();
        document.documentElement.style.visibility = 'visible';
    } catch (err) {
        console.error(err);
        document.documentElement.style.visibility = 'visible';
        alert('Errore: ' + err.message);
    }
}

function applicaPermessi() {
    // Chi non vede lo storico non ha tab né contatore
    if (!puoVedereStorico) {
        document.querySelector('.tabs-container').style.display = 'none';
        document.getElementById('badgeContatore').style.display = 'none';
    }
    // Solo l'admin può cancellare lo storico
    if (!puoCancellare) document.getElementById('btnCancellaStorico').style.display = 'none';
    if (!puoCancellare) document.getElementById('btnEliminaSingola').style.display = 'none';
}

async function esci() {
    await db.auth.signOut();
    window.location.href = 'login.html';
}

async function cambiaTab(tab) {
    if (tab === 'storico' && !puoVedereStorico) return;
    const isNuova = tab === 'nuova';
    document.getElementById('sezioneNuova').style.display = isNuova ? 'block' : 'none';
    document.getElementById('sezioneStorico').style.display = isNuova ? 'none' : 'block';
    document.getElementById('btnTabNuova').classList.toggle('active', isNuova);
    document.getElementById('btnTabStorico').classList.toggle('active', !isNuova);
    if (!isNuova) {
        await caricaSegnalazioni();
        renderizzaStorico();
    }
}

/* ------------------------------------------------------------------
   LETTURA SEGNALAZIONI DAL DATABASE
------------------------------------------------------------------ */
async function caricaSegnalazioni() {
    const { data, error } = await db
        .from('segnalazioni')
        .select('*')
        .order('creato_il', { ascending: false });

    if (error) {
        console.error(error);
        mostraToast('Impossibile caricare lo storico.');
        return;
    }

    listaSegnalazioni = data || [];

    // Le foto sono in un archivio privato: servono link temporanei (validi 1 ora)
    const percorsi = listaSegnalazioni.map(s => s.foto_carico);
    if (percorsi.length > 0) {
        const { data: firmati } = await db.storage.from('foto').createSignedUrls(percorsi, 3600);
        const mappa = {};
        (firmati || []).forEach(f => { if (f.signedUrl) mappa[f.path] = f.signedUrl; });
        listaSegnalazioni.forEach(s => { s.urlCarico = mappa[s.foto_carico] || ''; });
    }

    aggiornaInterfaccia();
}

/* ------------------------------------------------------------------
   COMPRESSIONE IMMAGINI
   Ridimensiona e converte in JPEG prima del caricamento online.
------------------------------------------------------------------ */
function comprimiImmagine(file, maxDim = 1280, qualita = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Lettura file fallita'));
        reader.onload = e => {
            const img = new Image();
            img.onerror = () => reject(new Error('Immagine non valida'));
            img.onload = () => {
                let { width, height } = img;
                if (width > height && width > maxDim) {
                    height = Math.round(height * (maxDim / width));
                    width = maxDim;
                } else if (height >= width && height > maxDim) {
                    width = Math.round(width * (maxDim / height));
                    height = maxDim;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', qualita));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function gestisciAnteprimaFoto(input, tipo) {
    if (!(input.files && input.files[0])) return;

    let result;
    try {
        result = await comprimiImmagine(input.files[0]);
    } catch (err) {
        mostraToast('Impossibile leggere la foto, riprova.');
        return;
    }

    if (tipo === 'carico') {
        immagineBase64 = result;
        document.getElementById('anteprimaFoto').src = result;
        document.getElementById('placeholderFoto').style.display = 'none';
        document.getElementById('contenitoreAnteprima').style.display = 'block';
    } else if (tipo === 'motrice') {
        fotoMotriceBase64 = result;
        document.getElementById('anteprimaMotrice').src = result;
        document.getElementById('placeholderMotrice').style.display = 'none';
        document.getElementById('contenitoreAnteprimaMotrice').style.display = 'block';
    } else if (tipo === 'rimorchio') {
        fotoRimorchioBase64 = result;
        document.getElementById('anteprimaRimorchio').src = result;
        document.getElementById('placeholderRimorchio').style.display = 'none';
        document.getElementById('contenitoreAnteprimaRimorchio').style.display = 'block';
    }
}

function rimuoviFoto(e, tipo) {
    if (e) e.stopPropagation();
    if (tipo === 'carico') {
        immagineBase64 = null;
        document.getElementById('fotoInput').value = '';
        document.getElementById('anteprimaFoto').src = '';
        document.getElementById('contenitoreAnteprima').style.display = 'none';
        document.getElementById('placeholderFoto').style.display = 'flex';
    } else if (tipo === 'motrice') {
        fotoMotriceBase64 = null;
        document.getElementById('targaMotriceInput').value = '';
        document.getElementById('anteprimaMotrice').src = '';
        document.getElementById('contenitoreAnteprimaMotrice').style.display = 'none';
        document.getElementById('placeholderMotrice').style.display = 'flex';
    } else if (tipo === 'rimorchio') {
        fotoRimorchioBase64 = null;
        document.getElementById('targaRimorchioInput').value = '';
        document.getElementById('anteprimaRimorchio').src = '';
        document.getElementById('contenitoreAnteprimaRimorchio').style.display = 'none';
        document.getElementById('placeholderRimorchio').style.display = 'flex';
    }
}

// Carica una foto (testo base64) nell'archivio online
async function caricaFoto(percorso, dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    const { error } = await db.storage.from('foto').upload(percorso, blob, { contentType: 'image/jpeg' });
    if (error) throw error;
}

document.getElementById('formSegnalazione').addEventListener('submit', async function(e) {
    e.preventDefault();
    const form = this;

    // Controlli con il toast unificato per tutti i campi obbligatori
    if (!document.getElementById('tipoRifiuto').value) return mostraToast('Seleziona il tipo di rifiuto!');
    if (!document.getElementById('posizione').value) return mostraToast('Seleziona la posizione!');
    if (!immagineBase64) return mostraToast('È obbligatorio allegare la foto del carico!');
    if (!fotoMotriceBase64) return mostraToast('È obbligatorio allegare la foto della targa motrice!');
    if (!fotoRimorchioBase64) return mostraToast('È obbligatorio allegare la foto della targa rimorchio!');
    if (!document.getElementById('numeroFormulario').value.trim()) return mostraToast('Inserisci il numero del formulario!');
    if (!document.getElementById('verificaObbligatoria').checked) return mostraToast('Conferma la spunta obbligatoria!');

    const tipoVal = document.getElementById('tipoRifiuto').value;
    const codiceCER = document.getElementById('tipoRifiuto').getAttribute('data-cer') || tipoVal.split(' ')[0];

    const btn = document.getElementById('btnInvia');
    const testoBtn = btn.querySelector('span');
    btn.disabled = true;
    testoBtn.textContent = 'Invio in corso...';

    // Albero: utente / segnalazione (data e ora) / foto
    const adesso = new Date();
    const pad = n => String(n).padStart(2, '0');
    const nomeSegnalazione = `${adesso.getFullYear()}-${pad(adesso.getMonth() + 1)}-${pad(adesso.getDate())}`
        + `_${pad(adesso.getHours())}-${pad(adesso.getMinutes())}-${pad(adesso.getSeconds())}`;
    const base = `${nomeUtente}/${nomeSegnalazione}`;

    const percorsoCarico = `${base}/carico.jpg`;
    const percorsoMotrice = `${base}/motrice.jpg`;
    const percorsoRimorchio = `${base}/rimorchio.jpg`;

    try {
        await caricaFoto(percorsoCarico, immagineBase64);
        await caricaFoto(percorsoMotrice, fotoMotriceBase64);
        await caricaFoto(percorsoRimorchio, fotoRimorchioBase64);

        const { error } = await db.from('segnalazioni').insert({
            utente: nomeUtente,
            tipo: tipoVal,
            codice_cer: codiceCER,
            posizione: document.getElementById('posizione').value,
            numero_formulario: document.getElementById('numeroFormulario').value.trim(),
            note_sicurezza: document.getElementById('noteSicurezza').value.trim(),
            note_generiche: document.getElementById('noteGeneriche').value.trim(),
            foto_carico: percorsoCarico,
            foto_motrice: percorsoMotrice,
            foto_rimorchio: percorsoRimorchio
        });
        if (error) throw error;
    } catch (err) {
        console.error(err);
        // Se la segnalazione non è stata registrata, elimina le foto già caricate
        db.storage.from('foto').remove([percorsoCarico, percorsoMotrice, percorsoRimorchio]);
        mostraToast('Invio non riuscito. Controlla la connessione e riprova.');
        btn.disabled = false;
        testoBtn.textContent = 'Invia Segnalazione';
        return;
    }

    btn.disabled = false;
    testoBtn.textContent = 'Invia Segnalazione';

    form.reset();
    resetDropdowns();
    rimuoviFoto(null, 'carico');
    rimuoviFoto(null, 'motrice');
    rimuoviFoto(null, 'rimorchio');

    // Primo toast di successo (durata standard 3000ms)
    mostraToast('Segnalazione inviata con successo!', 3000);

    // Secondo toast consecutivo per il promemoria magazzino ricambi (durata maggiore: 4500ms)
    setTimeout(() => {
        mostraToast('Mandare il trasportatore al magazzino ricambi per la firma formulario.', 4500);
    }, 3200);

    // Chi non può vedere lo storico resta sulla schermata Nuova (cambiaTab lo gestisce)
    cambiaTab('storico');
});

function resetDropdowns() {
    document.getElementById('tipoRifiuto').value = '';
    document.getElementById('tipoRifiuto').removeAttribute('data-cer');
    document.getElementById('dropdownSelectedText').textContent = 'Seleziona tipologia';
    document.getElementById('posizione').value = '';
    document.getElementById('dropdownSelectedTextPosizione').textContent = 'Seleziona posizione';
}

function aggiornaInterfaccia() {
    const count = listaSegnalazioni.length;
    document.getElementById('badgeContatore').textContent = `${count} ${count === 1 ? 'Segnalazione' : 'Segnalazioni'}`;
    document.getElementById('storicoCount').textContent = count;
}

// Evita che testo digitato dall'utente venga interpretato come HTML
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function renderizzaStorico() {
    const contenitore = document.getElementById('listaStorico');
    const vuoto = document.getElementById('storicoVuoto');
    contenitore.innerHTML = '';

    if (listaSegnalazioni.length === 0) {
        vuoto.style.display = 'block';
        return;
    }
    vuoto.style.display = 'none';

    listaSegnalazioni.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card storico-item';
        card.onclick = () => apriDettaglio(item);

        const data = new Date(item.creato_il).toLocaleString('it-IT');
        const formText = item.numero_formulario
            ? `<p class="storico-note">Formulario: ${escapeHtml(item.numero_formulario)}</p>`
            : '';
        card.innerHTML = `
            <img src="${escapeHtml(item.urlCarico)}" alt="Foto" class="storico-img">
            <div class="storico-info">
                <div class="storico-top">
                    <span class="tag-tipo">CER ${escapeHtml(item.codice_cer)}</span>
                    <span class="storico-data">${escapeHtml(data)}</span>
                </div>
                ${formText}
            </div>`;
        contenitore.appendChild(card);
    });
}

async function apriDettaglio(item) {
    if (!puoVedereStorico) return;
    segnalazioneAperta = item;

    // Link temporanei per le tre foto
    const { data: firmati } = await db.storage
        .from('foto')
        .createSignedUrls([item.foto_carico, item.foto_motrice, item.foto_rimorchio], 3600);
    const url = {};
    (firmati || []).forEach(f => { if (f.signedUrl) url[f.path] = f.signedUrl; });

    document.getElementById('modalFoto').src = url[item.foto_carico] || '';
    document.getElementById('modalTipo').textContent = item.tipo;
    document.getElementById('modalData').textContent = new Date(item.creato_il).toLocaleString('it-IT');
    document.getElementById('modalPosizione').textContent = item.posizione;
    document.getElementById('modalNumeroFormulario').textContent = item.numero_formulario;

    const divMotrice = document.getElementById('containerModalMotrice');
    if (url[item.foto_motrice]) {
        document.getElementById('modalFotoMotrice').src = url[item.foto_motrice];
        divMotrice.style.display = 'block';
    } else {
        divMotrice.style.display = 'none';
    }

    const divRimorchio = document.getElementById('containerModalRimorchio');
    if (url[item.foto_rimorchio]) {
        document.getElementById('modalFotoRimorchio').src = url[item.foto_rimorchio];
        divRimorchio.style.display = 'block';
    } else {
        divRimorchio.style.display = 'none';
    }

    const impNota = (idDiv, idText, val) => {
        const div = document.getElementById(idDiv);
        if (val) {
            document.getElementById(idText).textContent = `"${val}"`;
            div.style.display = 'flex';
        } else {
            div.style.display = 'none';
        }
    };
    impNota('modalContainerNoteSicurezza', 'modalNoteSicurezza', item.note_sicurezza);
    impNota('modalContainerNoteGeneriche', 'modalNoteGeneriche', item.note_generiche);

    document.getElementById('modalDettaglio').classList.add('show');
}

function chiudiModale() {
    document.getElementById('modalDettaglio').classList.remove('show');
}

// Popup di conferma dell'app (al posto di quello del browser)
let risolviConferma = null;

function chiediConferma(titolo, testo, etichetta = 'Elimina') {
    return new Promise(resolve => {
        document.getElementById('confermaTitolo').textContent = titolo;
        document.getElementById('confermaTesto').textContent = testo;
        document.getElementById('btnConfermaOk').textContent = etichetta;
        risolviConferma = resolve;
        document.getElementById('modalConferma').classList.add('show');
    });
}

function chiudiConferma(esito) {
    document.getElementById('modalConferma').classList.remove('show');
    if (risolviConferma) {
        risolviConferma(esito);
        risolviConferma = null;
    }
}

async function eliminaSegnalazione() {
    if (!puoCancellare || !segnalazioneAperta) return;
    if (!(await chiediConferma('Eliminare la segnalazione?', 'Verranno eliminati anche i dati e le foto. L\'operazione non si può annullare.'))) return;

    const item = segnalazioneAperta;

    // Elimina la riga dal database
    const { data, error } = await db
        .from('segnalazioni')
        .delete()
        .eq('id', item.id)
        .select();

    if (error || !data || data.length === 0) {
        console.error(error);
        mostraToast('Eliminazione non riuscita.');
        return;
    }

    // Elimina anche le tre foto dall'archivio
    await db.storage.from('foto').remove([item.foto_carico, item.foto_motrice, item.foto_rimorchio]);

    segnalazioneAperta = null;
    chiudiModale();
    await caricaSegnalazioni();
    renderizzaStorico();
    mostraToast('Segnalazione eliminata');
}

async function svuotaStorico() {
    if (!puoCancellare) return;
    if (!(await chiediConferma('Eliminare tutto lo storico?', 'Tutte le segnalazioni e le relative foto verranno eliminate. L\'operazione non si può annullare.', 'Elimina tutto'))) return;

    // Rilegge l'elenco aggiornato, così non restano foto orfane
    await caricaSegnalazioni();
    const percorsi = listaSegnalazioni.flatMap(s => [s.foto_carico, s.foto_motrice, s.foto_rimorchio]);

    const { error } = await db.from('segnalazioni').delete().gt('id', 0);
    if (error) {
        console.error(error);
        mostraToast('Cancellazione non riuscita.');
        return;
    }

    // Elimina anche le foto dall'archivio (a gruppi di 100)
    for (let i = 0; i < percorsi.length; i += 100) {
        await db.storage.from('foto').remove(percorsi.slice(i, i + 100));
    }

    listaSegnalazioni = [];
    aggiornaInterfaccia();
    renderizzaStorico();
    mostraToast('Storico svuotato');
}

function mostraToast(messaggio, durata = 3000) {
    const toast = document.getElementById('toast');
    document.getElementById('toastMsg').textContent = messaggio;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), durata);
}

function toggleDropdown(e) {
    e.stopPropagation();
    document.getElementById('customDropdownPosizione').classList.remove('open');
    document.getElementById('customDropdown').classList.toggle('open');
}

function selezionaOpzione(item) {
    const text = item.textContent.trim();
    const input = document.getElementById('tipoRifiuto');
    input.value = text;
    input.setAttribute('data-cer', item.getAttribute('data-value') || text.split(' ')[0]);
    document.getElementById('dropdownSelectedText').textContent = text;
    document.getElementById('customDropdown').classList.remove('open');
}

function toggleDropdownPosizione(e) {
    e.stopPropagation();
    document.getElementById('customDropdown').classList.remove('open');
    document.getElementById('customDropdownPosizione').classList.toggle('open');
}

function selezionaOpzionePosizione(item) {
    const text = item.textContent.trim();
    document.getElementById('posizione').value = text;
    document.getElementById('dropdownSelectedTextPosizione').textContent = text;
    document.getElementById('customDropdownPosizione').classList.remove('open');
}

document.addEventListener('click', () => {
    document.getElementById('customDropdown')?.classList.remove('open');
    document.getElementById('customDropdownPosizione')?.classList.remove('open');
});