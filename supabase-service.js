/**
 * Servicio Supabase para la invitación
 * Confirmación de asistencia, consultar pases y modificar acompañantes
 */

class SupabaseService {
    constructor() {
        try {
            if (typeof supabase !== 'undefined' && typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG && SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey) {
                this.client = supabase.createClient(
                    SUPABASE_CONFIG.url,
                    SUPABASE_CONFIG.anonKey
                );
            } else {
                this.client = null;
            }
        } catch (e) {
            this.client = null;
        }
    }

    /**
     * Buscar invitado en invitados_maestro por nombre (para cantidad de pases)
     */
    async findInvitadoMaestro(name) {
        if (!this.client) throw new Error('Cliente de Supabase no inicializado');
        try {
            const searchName = name.trim();
            let { data, error } = await this.client
                .from('invitados_maestro')
                .select('*')
                .ilike('nombre', searchName)
                .limit(1)
                .maybeSingle();

            if (!data) {
                const res = await this.client
                    .from('invitados_maestro')
                    .select('*')
                    .ilike('nombre', `%${searchName}%`)
                    .limit(1)
                    .maybeSingle();
                data = res.data;
            }
            if (!data) {
                const all = await this.client.from('invitados_maestro').select('*');
                if (all.data && all.data.length) {
                    const searchLower = searchName.toLowerCase();
                    data = all.data.find(inv => {
                        const n = (inv.nombre || '').toLowerCase();
                        return n.includes(searchLower) || searchLower.includes(n);
                    }) || null;
                }
            }
            if (error && error.code !== 'PGRST116') throw error;
            return data ? { id: data.id, nombre: data.nombre, cantidad_pases: data.cantidad_pases } : null;
        } catch (err) {
            console.error('Error findInvitadoMaestro:', err);
            return null;
        }
    }

    /**
     * Añadir invitado (confirmación de asistencia)
     */
    async addGuest(guestData) {
        if (!this.client) throw new Error('Cliente de Supabase no inicializado');
        const cantidad = (guestData.attendance === 'no' || guestData.attendance === false) ? 0 : 2;
        const row = {
            name: guestData.name,
            attendance: guestData.attendance,
            cantidad_acompañante: cantidad
        };
        const { data, error } = await this.client
            .from('wedding_guests')
            .insert([row])
            .select()
            .single();
        if (error) throw error;

        let mensaje = null;
        let cantidadPases = null;
        if (data.attendance === 'yes') {
            const maestro = await this.findInvitadoMaestro(data.name);
            if (maestro) {
                cantidadPases = maestro.cantidad_pases;
                mensaje = `Hola ${maestro.nombre} 💕\nHemos reservado ${cantidadPases} ${cantidadPases === 1 ? 'lugar' : 'lugares'} especialmente para ${cantidadPases === 1 ? 'ti' : 'ustedes'} 💫`;
            }
        }

        return {
            id: data.id,
            name: data.name,
            attendance: data.attendance,
            cantidad_acompañante: data.cantidad_acompañante ?? 0,
            cantidad_pases: cantidadPases,
            mensaje: mensaje,
            timestamp: new Date(data.created_at).toLocaleString('es-MX')
        };
    }

    /**
     * Obtener todos los invitados
     */
    async getAllGuests() {
        if (!this.client) throw new Error('Cliente de Supabase no inicializado');
        const { data, error } = await this.client
            .from('wedding_guests')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(g => {
            const raw = g.attendance != null ? String(g.attendance).trim().toLowerCase() : '';
            const attendance = (raw === 'yes' || raw === 'true' || g.attendance === true) ? 'yes' : 'no';
            return {
                id: g.id,
                name: g.name,
                attendance: attendance,
                cantidad_acompañante: g.cantidad_acompañante ?? 2,
                timestamp: new Date(g.created_at || g.updated_at).toLocaleString('es-MX')
            };
        });
    }

    /**
     * Buscar invitado por nombre en wedding_guests
     */
    async findGuestByName(name) {
        if (!this.client) throw new Error('Cliente de Supabase no inicializado');
        const searchName = name.trim();
        let { data, error } = await this.client
            .from('wedding_guests')
            .select('*')
            .ilike('name', searchName)
            .limit(1)
            .maybeSingle();

        if (!data) {
            const res = await this.client
                .from('wedding_guests')
                .select('*')
                .ilike('name', `%${searchName}%`)
                .limit(1)
                .maybeSingle();
            data = res.data;
            error = res.error;
        }
        if (error && error.code !== 'PGRST116') throw error;
        if (!data) return null;
        const raw = data.attendance != null ? String(data.attendance).trim().toLowerCase() : '';
        const attendance = (raw === 'yes' || raw === 'true' || data.attendance === true) ? 'yes' : 'no';
        return {
            id: data.id,
            name: data.name,
            attendance: attendance,
            cantidad_acompañante: data.cantidad_acompañante ?? 2,
            timestamp: new Date(data.created_at || data.updated_at).toLocaleString('es-MX')
        };
    }

    /**
     * Actualizar asistencia (yes/no). Al cancelar se pone de inmediato cantidad_acompañante en 0.
     */
    async updateAttendance(id, attendance) {
        if (!this.client) throw new Error('Cliente de Supabase no inicializado');
        if (attendance !== 'yes' && attendance !== 'no') throw new Error('attendance debe ser "yes" o "no"');

        const payload = attendance === 'no'
            ? { attendance: 'no', cantidad_acompañante: 0 }
            : { attendance: 'yes' };

        const { data, error } = await this.client
            .from('wedding_guests')
            .update(payload)
            .eq('id', id)
            .select()
            .single();
        if (error) {
            console.error('Supabase updateAttendance error:', error);
            throw new Error(error.message || 'No se pudo actualizar la asistencia. Revisa las políticas RLS en la tabla wedding_guests.');
        }
        if (!data) throw new Error('No se encontró el registro para actualizar.');
        return {
            id: data.id,
            name: data.name,
            attendance: data.attendance,
            cantidad_acompañante: data.cantidad_acompañante ?? 0,
            timestamp: data.updated_at ? new Date(data.updated_at).toLocaleString('es-MX') : ''
        };
    }

    /**
     * Actualizar cantidad de acompañantes (solo disminuir)
     */
    async updateCantidadAcompañantes(id, cantidad) {
        if (!this.client) throw new Error('Cliente de Supabase no inicializado');
        if (cantidad < 0) throw new Error('La cantidad debe ser >= 0');

        const { data: current, error: fetchErr } = await this.client
            .from('wedding_guests')
            .select('cantidad_acompañante')
            .eq('id', id)
            .single();
        if (fetchErr) throw fetchErr;
        const currentCant = current.cantidad_acompañante ?? 2;
        if (cantidad > currentCant) throw new Error('Solo se permite disminuir la cantidad de acompañantes.');

        const { data, error } = await this.client
            .from('wedding_guests')
            .update({ cantidad_acompañante: cantidad })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return {
            id: data.id,
            name: data.name,
            attendance: data.attendance,
            cantidad_acompañante: data.cantidad_acompañante,
            timestamp: new Date(data.updated_at).toLocaleString('es-MX')
        };
    }
}

let supabaseService = null;

function initSupabaseService() {
    if (typeof supabase !== 'undefined' && typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey) {
        supabaseService = new SupabaseService();
        if (typeof window !== 'undefined') window.supabaseService = supabaseService;
        return true;
    }
    return false;
}
