/* ============================================================
   CRAZY CHICKEN - Panel de administración
   3 secciones: Registro (en vivo, editable), Control de Ventas
   (kpis + gráficas por periodo) e Informe (resumen entre fechas).
   ============================================================ */
(() => {
    'use strict';

    const API = window.location.protocol === 'file:' ? 'http://localhost:3000/api' : '/api';
    const CLAVE_TOKEN = 'cc_admin_token';
    const token = sessionStorage.getItem(CLAVE_TOKEN);
    if (!token) { window.location.replace('index.html'); return; }

    const ESTADOS = ['Pendiente', 'En preparación', 'Listo', 'Entregado', 'Cancelado'];
    const CLASE = { 'Pendiente': 'pendiente', 'En preparación': 'preparacion', 'Listo': 'listo', 'Entregado': 'entregado', 'Cancelado': 'cancelado' };
    const MAX_POR_PRODUCTO = 20;

    const $ = (s) => document.querySelector(s);
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const dinero = (n) => 'Bs. ' + (Number.isInteger(n) ? n : Number(n).toFixed(2));
    const iso = (d) => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const HOY = iso(new Date());
    const FECHA_MIN = '2024-01-01'; // el negocio no tiene ventas antes de esta fecha

    function salir() {
        sessionStorage.removeItem(CLAVE_TOKEN);
        window.location.replace('index.html');
    }

    async function api(ruta, opciones = {}) {
        const r = await fetch(API + '/admin' + ruta, {
            ...opciones,
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
        });
        if (r.status === 401) { salir(); throw new Error('Sesión vencida'); }
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Error del servidor');
        return j;
    }

    let temporizador;
    function aviso(texto) {
        const a = $('#avisoAdmin');
        a.textContent = texto; a.classList.add('on');
        clearTimeout(temporizador);
        temporizador = setTimeout(() => a.classList.remove('on'), 2600);
    }

    function barras(filas, formato) {
        if (!filas.length) return '<div class="vacio">Sin datos en este periodo.</div>';
        const max = Math.max(...filas.map(f => f.valor)) || 1;
        return filas.map(f => `
            <div class="barra">
                <span>${esc(f.etiqueta)}</span><strong>${formato(f.valor)}</strong>
                <div class="pista"><div class="relleno" style="width:${(f.valor / max * 100).toFixed(1)}%"></div></div>
            </div>`).join('');
    }

    /* ---------- Validación de fechas (evita "años irreales") ---------- */
    // Los <input type="date"> llevan min/max, pero además se revisa aquí por si el
    // navegador deja escribir algo raro mientras se completa el campo.
    function fechaRealValida(s) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
        const [y, m, d] = s.split('-').map(Number);
        if (y < 2020 || y > 2100) return false;
        const dt = new Date(y, m - 1, d);
        return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
    }
    function validarRango(idDesde, idHasta, idError) {
        const elD = $(idDesde), elH = $(idHasta), elErr = $(idError);
        let ok = true, msg = '';
        if (!fechaRealValida(elD.value)) { ok = false; msg = 'La fecha "Desde" no es válida.'; }
        else if (!fechaRealValida(elH.value)) { ok = false; msg = 'La fecha "Hasta" no es válida.'; }
        else if (elH.value > HOY || elD.value > HOY) { ok = false; msg = 'No se pueden pedir fechas futuras.'; }
        else if (elD.value > elH.value) { ok = false; msg = '"Desde" no puede ser posterior a "Hasta".'; }
        elErr.classList.toggle('d-none', ok);
        if (!ok) elErr.textContent = msg;
        return ok;
    }
    function limitarFechas(...ids) {
        ids.forEach(id => { $(id).min = FECHA_MIN; $(id).max = HOY; });
    }

    /* ============================================================
       NAVEGACIÓN ENTRE SECCIONES
       ============================================================ */
    let tabActual = 'registro';
    function irATab(tab) {
        tabActual = tab;
        document.querySelectorAll('.tab-panel').forEach(s => s.classList.toggle('d-none', s.id !== 'tab-' + tab));
        document.querySelectorAll('#tabsAdmin button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
        if (tab === 'registro') cargarRegistro();
        if (tab === 'ventas') cargarVentas();
    }
    $('#tabsAdmin').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-tab]');
        if (b) irATab(b.dataset.tab);
    });

    /* ============================================================
       CATÁLOGO DE PRODUCTOS (para agregar productos al editar)
       ============================================================ */
    let catalogo = [];
    async function cargarCatalogo() {
        try {
            const r = await fetch(`${API}/productos`);
            catalogo = r.ok ? await r.json() : [];
        } catch { catalogo = []; }
    }

    /* ============================================================
       SECCIÓN 1: REGISTRO (en vivo, con editar / eliminar)
       ============================================================ */
    let pedidoEnEdicion = null;     // num_pedido que se está editando
    let borradorEdicion = null;     // Map id_producto -> cantidad, mientras se edita
    let mayorVistoRegistro = null;

    function filaEdicion(idProd, nombre, precio, cantidad) {
        return `
            <div class="fila" data-id="${idProd}">
                <span>${esc(nombre)} <small class="text-secondary">(${dinero(precio)} c/u)</small></span>
                <span class="cantidad-ctl">
                    <button type="button" data-accion="menos" data-id="${idProd}" aria-label="Quitar uno">−</button>
                    <strong>${cantidad}</strong>
                    <button type="button" data-accion="mas" data-id="${idProd}" aria-label="Agregar uno">+</button>
                </span>
                <button type="button" class="btn btn-sm text-danger" data-accion="quitar" data-id="${idProd}"><i class="bi bi-trash3"></i></button>
            </div>`;
    }

    function pintarEdicion(numPedido) {
        const filas = [...borradorEdicion.entries()].map(([id, cant]) => {
            const p = catalogo.find(x => x.id_producto === id);
            return p ? filaEdicion(id, p.nombre_producto, p.precio, cant) : '';
        }).join('') || '<p class="text-secondary small">Sin productos. Agrega uno abajo.</p>';

        const disponibles = catalogo.filter(p => !borradorEdicion.has(p.id_producto));
        const opciones = disponibles.map(p => `<option value="${p.id_producto}">${esc(p.nombre_producto)} — ${dinero(p.precio)}</option>`).join('');
        const total = [...borradorEdicion.entries()].reduce((s, [id, cant]) => {
            const p = catalogo.find(x => x.id_producto === id);
            return s + (p ? p.precio * cant : 0);
        }, 0);

        return `
            <div class="edicion" data-num="${numPedido}">
                ${filas}
                <div class="agregar">
                    <select class="form-select form-select-sm" data-rol="nuevoProducto">
                        <option value="">${disponibles.length ? 'Agregar producto…' : 'No hay más productos para agregar'}</option>
                        ${opciones}
                    </select>
                    <button type="button" class="btn btn-sm btn-outline-warning" data-accion="agregarProducto">Agregar</button>
                </div>
                <div class="d-flex justify-content-between align-items-center mt-3">
                    <strong>Nuevo total: <span class="text-warning">${dinero(Math.round(total * 100) / 100)}</span></strong>
                    <div class="d-flex gap-2">
                        <button type="button" class="btn btn-sm btn-warning fw-bold" data-accion="guardarEdicion">Guardar cambios</button>
                        <button type="button" class="btn btn-sm btn-outline-light" data-accion="cancelarEdicion">Cancelar</button>
                    </div>
                </div>
            </div>`;
    }

    function tarjetaPedido(p, editable) {
        const enEdicion = editable && pedidoEnEdicion === p.num_pedido;
        return `
            <article class="pedido est-${CLASE[p.estado]}" data-num="${p.num_pedido}">
                <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                    <div>
                        <span class="num">#${p.num_pedido}</span>
                        <span class="text-secondary ms-2">${p.fecha_pedido.split('-').reverse().join('/')} · ${esc(p.hora_pedido)}</span>
                    </div>
                    <select class="form-select form-select-sm sel-estado" data-num="${p.num_pedido}" aria-label="Estado del pedido ${p.num_pedido}">
                        ${ESTADOS.map(e => `<option ${e === p.estado ? 'selected' : ''}>${e}</option>`).join('')}
                    </select>
                </div>
                <div class="mt-1"><strong>${esc(p.nombre_cliente)}</strong> · <a class="text-warning" href="tel:${esc(p.telefono_cliente)}">${esc(p.telefono_cliente)}</a></div>
                <div class="mt-1">
                    <span class="chip ${p.tipo_entrega === 'Delivery' ? 'delivery' : ''}">${esc(p.tipo_entrega)}</span>
                    <span class="chip">${esc(p.metodo_pago)}</span>
                    ${p.direccion ? `<small class="text-secondary"><i class="bi bi-geo-alt"></i> ${esc(p.direccion)}</small>` : ''}
                </div>

                ${enEdicion ? pintarEdicion(p.num_pedido) : `
                    <ul class="items">
                        ${p.items.map(i => `<li><span><span class="cant">${i.cantidad}×</span>${esc(i.nombre_producto)}</span><span class="text-secondary">${dinero(i.subtotal)}</span></li>`).join('')}
                    </ul>
                    ${p.notas ? `<div class="small text-warning mb-2"><i class="bi bi-chat-left-text"></i> ${esc(p.notas)}</div>` : ''}
                    <div class="text-end fs-5 fw-bold">Total: <span class="text-warning">${dinero(p.total)}</span></div>
                    ${editable ? `
                        <div class="pedido-acciones">
                            <button type="button" class="btn btn-sm btn-outline-warning" data-accion="editarPedido" data-num="${p.num_pedido}"><i class="bi bi-pencil"></i> Editar productos</button>
                            <button type="button" class="btn btn-sm btn-outline-danger" data-accion="eliminarPedido" data-num="${p.num_pedido}"><i class="bi bi-trash3"></i> Eliminar pedido</button>
                        </div>` : ''}
                `}
            </article>`;
    }

    let pedidosRegistro = [];
    function pintarRegistro() {
        $('#listaRegistro').innerHTML = pedidosRegistro.length
            ? pedidosRegistro.map(p => tarjetaPedido(p, true)).join('')
            : '<div class="panel vacio">No hay pedidos hoy todavía.</div>';
    }

    async function cargarRegistro() {
        try {
            const q = new URLSearchParams();
            if ($('#filtroEstadoRegistro').value) q.set('estado', $('#filtroEstadoRegistro').value);
            const pedidos = await api('/registro?' + q);
            pedidosRegistro = pedidos;
            if (!pedidoEnEdicion) pintarRegistro();
            $('#ultimaActRegistro').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

            const mayor = pedidos.reduce((m, p) => Math.max(m, p.num_pedido), 0);
            if (mayorVistoRegistro !== null && mayor > mayorVistoRegistro) aviso('¡Llegó un pedido nuevo! #' + mayor);
            mayorVistoRegistro = Math.max(mayorVistoRegistro ?? 0, mayor);
        } catch (e) {
            if (e.message !== 'Sesión vencida') $('#listaRegistro').innerHTML = `<div class="panel vacio text-danger">${esc(e.message)}</div>`;
        }
    }

    function empezarEdicion(num) {
        const p = pedidosRegistro.find(x => x.num_pedido === num);
        if (!p) return;
        pedidoEnEdicion = num;
        borradorEdicion = new Map(p.items.map(i => [i.id_producto, i.cantidad]));
        pintarRegistro();
    }
    function cancelarEdicion() {
        pedidoEnEdicion = null; borradorEdicion = null;
        pintarRegistro();
    }
    async function guardarEdicion(num) {
        if (borradorEdicion.size === 0) return aviso('El pedido debe tener al menos un producto.');
        try {
            await api(`/pedidos/${num}/items`, {
                method: 'PUT',
                body: JSON.stringify({ items: [...borradorEdicion.entries()].map(([id_producto, cantidad]) => ({ id_producto, cantidad })) })
            });
            aviso(`Pedido #${num} actualizado`);
            pedidoEnEdicion = null; borradorEdicion = null;
            cargarRegistro();
        } catch (e) { aviso(e.message); }
    }
    async function eliminarPedido(num) {
        if (!confirm(`¿Eliminar el pedido #${num}? Esta acción no se puede deshacer.`)) return;
        try {
            await api(`/pedidos/${num}`, { method: 'DELETE' });
            aviso(`Pedido #${num} eliminado`);
            if (pedidoEnEdicion === num) { pedidoEnEdicion = null; borradorEdicion = null; }
            cargarRegistro();
        } catch (e) { aviso(e.message); }
    }

    $('#filtroEstadoRegistro').addEventListener('change', cargarRegistro);

    $('#listaRegistro').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-accion]');
        if (!b) return;
        const num = Number(b.dataset.num || b.closest('.edicion')?.dataset.num);
        const idProd = Number(b.dataset.id);

        if (b.dataset.accion === 'editarPedido') return empezarEdicion(num);
        if (b.dataset.accion === 'cancelarEdicion') return cancelarEdicion();
        if (b.dataset.accion === 'eliminarPedido') return eliminarPedido(num);
        if (b.dataset.accion === 'guardarEdicion') return guardarEdicion(num);

        if (b.dataset.accion === 'mas') {
            if ((borradorEdicion.get(idProd) || 0) >= MAX_POR_PRODUCTO) return aviso(`Máximo ${MAX_POR_PRODUCTO} por producto`);
            borradorEdicion.set(idProd, (borradorEdicion.get(idProd) || 0) + 1);
            return pintarRegistro();
        }
        if (b.dataset.accion === 'menos' || b.dataset.accion === 'quitar') {
            const nueva = b.dataset.accion === 'quitar' ? 0 : (borradorEdicion.get(idProd) || 0) - 1;
            if (nueva <= 0) borradorEdicion.delete(idProd); else borradorEdicion.set(idProd, nueva);
            return pintarRegistro();
        }
        if (b.dataset.accion === 'agregarProducto') {
            const sel = b.parentElement.querySelector('[data-rol="nuevoProducto"]');
            const id = Number(sel.value);
            if (!id) return aviso('Elige un producto de la lista.');
            borradorEdicion.set(id, (borradorEdicion.get(id) || 0) + 1);
            return pintarRegistro();
        }
    });

    $('#listaRegistro').addEventListener('change', async (e) => {
        const sel = e.target.closest('.sel-estado');
        if (!sel) return;
        try {
            await api(`/pedidos/${sel.dataset.num}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: sel.value }) });
            aviso(`Pedido #${sel.dataset.num}: ${sel.value}`);
        } catch (err) { aviso(err.message); }
        cargarRegistro();
    });

    /* ============================================================
       SECCIÓN 2: CONTROL DE VENTAS
       ============================================================ */
    function ponerRangoVentas(rango) {
        const hoyD = new Date();
        $('#hastaVentas').value = HOY;
        if (rango === 'hoy') $('#desdeVentas').value = HOY;
        if (rango === '7') $('#desdeVentas').value = iso(new Date(hoyD.getTime() - 6 * 86400000));
        if (rango === 'mes') $('#desdeVentas').value = iso(new Date(hoyD.getFullYear(), hoyD.getMonth(), 1));
    }

    function pintarResumenVentas(r) {
        $('#kpisVentas').innerHTML = [
            [dinero(r.vendido), 'Total vendido'],
            [r.pedidos, 'Pedidos (sin cancelados)'],
            [dinero(r.ticket_promedio), 'Ticket promedio'],
            [r.en_curso, 'En curso (pendientes / preparando)']
        ].map(([v, e]) => `<div class="col-6 col-lg-3"><div class="kpi"><div class="valor">${v}</div><div class="etiqueta">${e}</div></div></div>`).join('');
        $('#repMetodo').innerHTML = barras(r.porMetodo, dinero);
        $('#repTop').innerHTML = barras(r.topProductos, n => n + ' uds');
        $('#repDia').innerHTML = barras(r.porDia.map(d => ({ etiqueta: d.etiqueta.split('-').reverse().join('/'), valor: d.valor })), dinero);
    }

    function pintarListaVentas(pedidos) {
        $('#listaVentas').innerHTML = pedidos.length
            ? pedidos.map(p => tarjetaPedido(p, false)).join('')
            : '<div class="panel vacio">No hay pedidos en este periodo.</div>';
    }

    async function cargarVentas() {
        if (!validarRango('#desdeVentas', '#hastaVentas', '#errorFechaVentas')) return;
        const q = new URLSearchParams({ desde: $('#desdeVentas').value, hasta: $('#hastaVentas').value });
        const qEstado = new URLSearchParams(q);
        if ($('#estadoVentas').value) qEstado.set('estado', $('#estadoVentas').value);
        try {
            const [pedidos, resumen] = await Promise.all([api('/pedidos?' + qEstado), api('/resumen?' + q)]);
            pintarListaVentas(pedidos);
            pintarResumenVentas(resumen);
            $('#ultimaActVentas').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            if (e.message !== 'Sesión vencida') $('#listaVentas').innerHTML = `<div class="panel vacio text-danger">${esc(e.message)}</div>`;
        }
    }

    $('#filtrosVentas').addEventListener('submit', (e) => { e.preventDefault(); cargarVentas(); });
    document.querySelectorAll('[data-rango-ventas]').forEach(b => b.addEventListener('click', () => { ponerRangoVentas(b.dataset.rangoVentas); cargarVentas(); }));

    /* ============================================================
       SECCIÓN 3: INFORME DE VENTAS (resumen entre dos fechas)
       ============================================================ */
    function ponerRangoInforme() {
        $('#hastaInforme').value = HOY;
        $('#desdeInforme').value = HOY;
    }

    function pintarInforme(pedidos, resumen, desde, hasta) {
        $('#cabezaInforme').innerHTML = `
            <h2 class="h5 fw-bold mb-1">Informe de ventas</h2>
            <p class="text-secondary mb-0">Del ${desde.split('-').reverse().join('/')} al ${hasta.split('-').reverse().join('/')}</p>`;

        $('#kpisInforme').innerHTML = [
            [dinero(resumen.vendido), 'Total vendido'],
            [resumen.pedidos, 'Pedidos registrados'],
            [dinero(resumen.ticket_promedio), 'Ticket promedio']
        ].map(([v, e]) => `<div class="col-6 col-lg-4"><div class="kpi"><div class="valor">${v}</div><div class="etiqueta">${e}</div></div></div>`).join('');

        const filas = pedidos.length
            ? pedidos.slice().reverse().map(p => `
                <tr>
                    <td>#${p.num_pedido}</td>
                    <td>${p.fecha_pedido.split('-').reverse().join('/')}</td>
                    <td>${esc(p.hora_pedido)}</td>
                    <td>${esc(p.nombre_cliente)}</td>
                    <td>${esc(p.tipo_entrega)}</td>
                    <td>${esc(p.metodo_pago)}</td>
                    <td>${esc(p.estado)}</td>
                    <td class="num">${dinero(p.total)}</td>
                </tr>`).join('')
            : `<tr><td colspan="8" class="text-center text-secondary py-3">No hay ventas registradas en este periodo.</td></tr>`;

        $('#tablaInforme').innerHTML = `
            <thead><tr>
                <th>Pedido</th><th>Fecha</th><th>Hora</th><th>Cliente</th><th>Entrega</th><th>Pago</th><th>Estado</th><th class="num">Total</th>
            </tr></thead>
            <tbody>${filas}</tbody>
            <tfoot><tr><td colspan="7">Total del periodo</td><td class="num">${dinero(resumen.vendido)}</td></tr></tfoot>`;
    }

    async function generarInforme(e) {
        e.preventDefault();
        if (!validarRango('#desdeInforme', '#hastaInforme', '#errorFechaInforme')) return;
        const desde = $('#desdeInforme').value, hasta = $('#hastaInforme').value;
        const q = new URLSearchParams({ desde, hasta });
        try {
            const [pedidos, resumen] = await Promise.all([api('/pedidos?' + q), api('/resumen?' + q)]);
            pintarInforme(pedidos, resumen, desde, hasta);
        } catch (err) {
            if (err.message !== 'Sesión vencida') aviso(err.message);
        }
    }
    $('#filtrosInforme').addEventListener('submit', generarInforme);
    $('#btnImprimir').addEventListener('click', () => window.print());

    /* ============================================================
       ARRANQUE
       ============================================================ */
    $('#btnSalir').addEventListener('click', salir);
    limitarFechas('#desdeVentas', '#hastaVentas', '#desdeInforme', '#hastaInforme');
    ponerRangoVentas('hoy');
    ponerRangoInforme();

    (async () => {
        await cargarCatalogo();
        irATab('registro');
        generarInforme(new Event('submit'));
    })();

    // Actualización automática de la sección Registro cada 15 s (si no se está editando ni escribiendo)
    setInterval(() => {
        if (tabActual !== 'registro') return;
        if (pedidoEnEdicion !== null) return;
        const enfocado = document.activeElement;
        if (enfocado && (enfocado.tagName === 'SELECT' || enfocado.tagName === 'INPUT')) return;
        cargarRegistro();
    }, 15000);
})();
