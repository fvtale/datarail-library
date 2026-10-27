/* Text Swap: take edited text out of a PDF instead of painting over it.

   pdf.js has already worked out every glyph on the page, with its width, in the
   order the content stream draws it. walk() reads the same content streams with
   pdf-lib, pairs each text operator with pdf.js's glyphs, and rewrites the
   operators so the glyphs inside an edited line are gone while everything drawn
   after them stays exactly where it was. Text inside a form XObject is handled by
   giving this page its own copy of the form.

   Anything it cannot pair up exactly throws, and the caller falls back to covering
   the old text and says so. index.html also reads the saved file back to check. */
"use strict";
const TextScrub = (() => {
  const P = PDFLib, N = k => P.PDFName.of(k), ID = [1, 0, 0, 1, 0, 0];
  const enc = s => new TextEncoder().encode(s);
  const concat = parts => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts){ out.set(p, at); at += p.length; } return out; };
  const hex = b => '<' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('') + '>';
  const fmt = v => { const s = String(Math.round(v*1000)/1000); return /e/.test(s) ? '0' : s; };
  const mul = (a, b) => [a[0]*b[0] + a[1]*b[2], a[0]*b[1] + a[1]*b[3], a[2]*b[0] + a[3]*b[2], a[2]*b[1] + a[3]*b[3], a[4]*b[0] + a[5]*b[2] + b[4], a[4]*b[1] + a[5]*b[3] + b[5]];
  const apply = (m, x, y) => [x*m[0] + y*m[2] + m[4], x*m[1] + y*m[3] + m[5]];

  /* ---------- content stream syntax ---------- */
  const isWS = c => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
  const isDelim = c => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
  const latin1 = b => { let s = ''; for (const c of b) s += String.fromCharCode(c); return s; };
  const ESC = {110: 10, 114: 13, 116: 9, 98: 8, 102: 12};

  // tokens with their byte ranges, so an operator can be swapped out and every other byte kept as it was
  function lex(s){
    const out = [], n = s.length; let i = 0;
    const fail = m => { throw new Error(`content stream: ${m} at byte ${i}`); };
    while (i < n){
      const c = s[i];
      if (isWS(c)){ i++; continue; }
      if (c === 37){ while (i < n && s[i] !== 10 && s[i] !== 13) i++; continue; }
      const st = i;
      if (c === 40){                                       // (literal string)
        const v = []; let depth = 1; i++;
        while (i < n){
          let ch = s[i++];
          if (ch === 92){
            const e = s[i++];
            if (e in ESC) v.push(ESC[e]);
            else if (e >= 48 && e <= 55){ let o = e - 48; for (let k = 0; k < 2 && s[i] >= 48 && s[i] <= 55; k++) o = o*8 + s[i++] - 48; v.push(o & 255); }
            else if (e === 13){ if (s[i] === 10) i++; }
            else if (e !== 10) v.push(e);
            continue;
          }
          if (ch === 40) depth++;
          else if (ch === 41 && --depth === 0) break;
          if (ch === 13){ if (s[i] === 10) i++; ch = 10; }
          v.push(ch);
        }
        if (depth) fail('unterminated string');
        out.push({t: 'str', v: Uint8Array.from(v), s: st, e: i}); continue;
      }
      if (c === 60 && s[i+1] === 60){ out.push({t: '<<', s: st, e: i += 2}); continue; }
      if (c === 62 && s[i+1] === 62){ out.push({t: '>>', s: st, e: i += 2}); continue; }
      if (c === 60){                                       // <hex string>
        let h = ''; i++;
        while (i < n && s[i] !== 62){ if (!isWS(s[i])) h += String.fromCharCode(s[i]); i++; }
        if (i >= n || /[^0-9a-f]/i.test(h)) fail('bad hex string');
        i++; if (h.length & 1) h += '0';
        const v = new Uint8Array(h.length/2); for (let k = 0; k < v.length; k++) v[k] = parseInt(h.substr(2*k, 2), 16);
        out.push({t: 'str', v, s: st, e: i}); continue;
      }
      if (c === 91 || c === 93){ out.push({t: c === 91 ? '[' : ']', s: st, e: ++i}); continue; }
      if (c === 47){                                       // /Name
        i++; while (i < n && !isWS(s[i]) && !isDelim(s[i])) i++;
        out.push({t: 'name', v: latin1(s.subarray(st+1, i)).replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), s: st, e: i}); continue;
      }
      while (i < n && !isWS(s[i]) && !isDelim(s[i])) i++;
      if (i === st) fail('unexpected ' + String.fromCharCode(c));
      const w = latin1(s.subarray(st, i));
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)){ out.push({t: 'num', v: parseFloat(w), s: st, e: i}); continue; }
      out.push({t: 'kw', v: w, s: st, e: i});
      if (w === 'ID'){                                     // inline image data runs to EI, and may itself contain "EI"
        let j = ++i;
        for (;; j++){
          if (j + 1 >= n) fail('inline image without EI');
          if (s[j] !== 69 || s[j+1] !== 73 || !isWS(s[j-1]) || (j + 2 < n && !isWS(s[j+2]))) continue;
          let text = true; for (let k = j + 2; k < Math.min(n, j + 24); k++) if (s[k] > 126 || (s[k] < 32 && !isWS(s[k]))){ text = false; break; }
          if (text) break;
        }
        out.push({t: 'kw', v: 'EI', s: j, e: i = j + 2});
      }
    }
    return out;
  }

  // operands grouped under their operator; arrays and dictionaries become one operand each
  function parse(toks){
    const insts = []; let args = [], k = 0;
    const value = () => {
      const t = toks[k++];
      if (t.t === '[' || t.t === '<<'){
        const close = t.t === '[' ? ']' : '>>', v = [];
        while (k < toks.length && toks[k].t !== close) v.push(value());
        if (k >= toks.length) throw new Error('content stream: unclosed ' + t.t);
        return {t: t.t === '[' ? 'arr' : 'dict', v, s: t.s, e: toks[k++].e};
      }
      if (t.t === ']' || t.t === '>>') throw new Error('content stream: stray ' + t.t);
      return t;
    };
    while (k < toks.length){
      const t = toks[k];
      if (t.t === 'kw'){ k++; insts.push({op: t.v, args, s: args.length ? args[0].s : t.s, e: t.e}); args = []; }
      else args.push(value());
    }
    return {insts, rest: args};
  }

  function splice(src, edits){
    const out = []; let at = 0;
    for (const x of [...edits].sort((p, q) => p.s - q.s)){
      if (x.s < at) throw new Error('overlapping edits');
      out.push(src.subarray(at, x.s), x.b); at = x.e;
    }
    out.push(src.subarray(at));
    return concat(out);
  }

  // a marked-content property list without the alternative text that would still spell out the old words
  function stripAlt(src, d){
    const out = [enc(' <<')];
    for (let i = 0; i + 1 < d.v.length; i += 2){
      const k = d.v[i], v = d.v[i+1];
      if (k.t === 'name' && /^(ActualText|Alt|E)$/.test(k.v)) continue;
      out.push(enc(' '), src.subarray(k.s, k.e), enc(' '), src.subarray(v.s, v.e));
    }
    out.push(enc('>> '));
    return concat(out);
  }

  /* ---------- the walk ----------
     shows:   pdf.js's showText glyph lists for this page, in drawing order (annotations off)
     regions: edited lines, from pdf.js text items: {ox, oy, w, size, dir, up} in PDF user space
     opts.commit:      rewrite the page; without it, only report what would happen
     opts.scrubImages: also take every image off the page (the caller paints a flattened copy behind)
     Returns what was found: glyphs removed per region (and how many were invisible),
     visible text and path painting left on the page, the finest image resolution,
     and the images taken off (to check after prune() that they really left the file). */
  function walk(doc, pageIndex, shows, regions, opts = {}){
    const ctx = doc.context, node = doc.getPage(pageIndex).node;
    const stats = {regions: regions.map(() => ({glyphs: 0, hidden: 0})), visibleText: 0, paths: 0, images: 0, density: 0, changed: false, scrubbed: []};
    const fonts = new Map();
    let si = 0, depth = 0;

    const fontOf = (res, name) => {
      const fd = res.lookupMaybe(N('Font'), P.PDFDict), f = fd && name !== undefined && fd.lookupMaybe(N(name), P.PDFDict);
      if (!f) return {simple: true, vertical: false, fm0: 0.001};      // pdf.js substitutes a font; its widths still come from pdf.js
      if (!fonts.has(f)){
        const sub = f.lookupMaybe(N('Subtype'), P.PDFName), cmap = f.lookupMaybe(N('Encoding'), P.PDFName);
        const fm = sub === N('Type3') && f.lookupMaybe(N('FontMatrix'), P.PDFArray);
        fonts.set(f, {simple: sub !== N('Type0'), vertical: sub === N('Type0') && !!cmap && /-V$/.test(cmap.decodeText()),
          fm0: fm ? fm.lookup(0, P.PDFNumber).asNumber() : 0.001});
      }
      return fonts.get(f);
    };
    const xobjOf = (res, name) => {
      const xd = res.lookupMaybe(N('XObject'), P.PDFDict), ref = xd && xd.get(N(name)), o = ref && ctx.lookup(ref);
      return o instanceof P.PDFRawStream ? {ref, o, xd} : null;
    };
    const isImage = v => { const o = ctx.lookup(v); return o instanceof P.PDFRawStream && o.dict.lookupMaybe(N('Subtype'), P.PDFName) === N('Image'); };
    // resources of their own, without the images taken off: otherwise they stay reachable and in the file
    const withoutImages = res => {
      const out = res.clone(ctx), xd = res.lookupMaybe(N('XObject'), P.PDFDict);
      if (xd){ const keep = xd.clone(ctx); for (const [k, v] of xd.entries()) if (isImage(v)) keep.delete(k); out.set(N('XObject'), keep); }
      return out;
    };
    const num = o => { const v = o && ctx.lookup(o); return v instanceof P.PDFNumber ? v.asNumber() : 0; };
    const hit = (M, cx, cy) => {
      if (Math.abs(M[1]) > 1e-3*Math.abs(M[0]) || Math.abs(M[2]) > 1e-3*Math.abs(M[3])) return -1;
      for (let r = 0; r < regions.length; r++){
        const g = regions[r];
        if (Math.sign(M[0]) !== g.dir || Math.sign(M[3]) !== g.up) continue;
        const along = (cx - g.ox)*g.dir, tol = 0.1*g.size;
        if (along >= -tol && along <= g.w + tol && Math.abs((cy - g.oy)*g.up) <= 0.3*g.size) return r;
      }
      return -1;
    };

    function run(chunks, res, gs0, outerMc){
      if (++depth > 12) throw new Error('forms nested too deep');
      let gs = {...gs0}, tm = ID, tlm = ID, ci = 0, bi = null;
      const stack = [], mc = [], edits = chunks.map(() => []);
      const moveTo = (tx, ty) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm; };
      const image = (w, h) => {
        stats.images++;
        const sx = Math.hypot(gs.ctm[0], gs.ctm[1]), sy = Math.hypot(gs.ctm[2], gs.ctm[3]);
        if (sx && sy) stats.density = Math.max(stats.density, w/sx, h/sy);
      };

      // one text-showing operator: drop the glyphs inside a region, and turn each dropped run
      // into a TJ adjustment of the same width so whatever follows does not move
      const show = (ins, elems, prefix) => {
        const g = shows[si++], f = gs.font;
        if (!g) throw new Error('more text operators than pdf.js drew');
        if (!f) throw new Error('text shown before any font is set');
        if (f.vertical) throw new Error('vertical text');
        let bytes = 0, glyphs = 0;
        for (const el of elems){ if (el && el.t === 'str') bytes += el.v.length; else if (!el || el.t !== 'num') throw new Error('bad text operand'); }
        for (const x of g) if (typeof x !== 'number') glyphs++;
        const k = glyphs ? bytes/glyphs : 1;
        if (k !== 1 && (f.simple || k !== 2)) throw new Error('cannot pair glyphs with their bytes');
        const parts = [], all = outerMc.concat(mc);
        let gi = 0, gap = 0, any = false;
        // adjacent numbers are merged: pdf.js's text extraction adds a stray Tc for the empty run between two
        const adjust = v => { if (typeof parts[parts.length - 1] === 'number') parts[parts.length - 1] += v; else parts.push(v); };
        const flush = () => { if (gap){ adjust(-gap*1000/gs.size); gap = 0; } };
        for (const el of elems){
          if (el.t === 'num'){
            if (typeof g[gi++] !== 'number') throw new Error('TJ out of step with pdf.js');
            flush(); adjust(el.v);
            tm = mul([1, 0, 0, 1, -el.v/1000*gs.size*gs.th, 0], tm);
            continue;
          }
          if (el.v.length % k) throw new Error('string splits a character code');
          let kept = 0;                                    // first byte of the kept run not yet emitted
          for (let c = 0; c < el.v.length; c += k){
            const x = g[gi++];
            if (!x || typeof x === 'number') throw new Error('TJ out of step with pdf.js');
            const d = x.width*f.fm0*gs.size + gs.tc + (x.isSpace ? gs.tw : 0), adv = d*gs.th;
            const M = mul(tm, gs.ctm), [cx, cy] = apply(M, adv/2, gs.rise), r = hit(M, cx, cy);
            const hidden = gs.tr === 3 || gs.tr === 7;
            if (r >= 0){
              stats.regions[r].glyphs++; if (hidden) stats.regions[r].hidden++;
              for (const m of all) if (m) m.drop = true;
              if (c > kept){ flush(); parts.push(el.v.subarray(kept, c)); }
              gap += d; kept = c + k; any = true;
            } else if (!hidden) stats.visibleText++;
            tm = mul([1, 0, 0, 1, adv, 0], tm);
          }
          if (el.v.length > kept){ flush(); parts.push(el.v.subarray(kept)); }
        }
        flush();
        if (gi !== g.length) throw new Error('glyph count differs from pdf.js');
        if (!any) return;
        if (!gs.size) throw new Error('zero font size');
        edits[ci].push({s: ins.s, e: ins.e, b: enc(` ${prefix}[${parts.map(p => typeof p === 'number' ? fmt(p) : hex(p)).join(' ')}] TJ `)});
      };

      const form = (ins, x) => {
        const m = x.o.dict.lookupMaybe(N('Matrix'), P.PDFArray), mtx = m ? m.asArray().map(num) : ID;
        const fres = x.o.dict.lookupMaybe(N('Resources'), P.PDFDict) || res;
        const src = P.decodePDFRawStream(x.o).decode();
        const sub = run([src], fres, {...gs, ctm: mul(mtx, gs.ctm)}, outerMc.concat(mc)).edits[0];
        if (!sub.length) return;
        const nm = ins.args[0];
        if (!opts.commit){ edits[ci].push({s: nm.s, e: nm.e, b: chunks[ci].subarray(nm.s, nm.e)}); return; }
        // this page gets its own copy of the form; the original may be drawn elsewhere too
        const copy = ctx.flateStream(splice(src, sub));
        for (const [key, v] of x.o.dict.entries()) if (!/^(Length|Filter|DecodeParms)$/.test(key.decodeText())) copy.dict.set(key, v);
        if (opts.scrubImages) copy.dict.set(N('Resources'), withoutImages(fres));
        let name, i = 0; do name = 'TSForm' + (++i); while (x.xd.has(N(name)));
        x.xd.set(N(name), ctx.register(copy));
        edits[ci].push({s: nm.s, e: nm.e, b: enc(` /${name} `)});
      };

      for (; ci < chunks.length; ci++){
        const {insts, rest} = parse(lex(chunks[ci]));
        if (rest.length) throw new Error('an operator is split across content streams');
        for (const ins of insts){
          const a = ins.args, n = i => { if (!a[i] || a[i].t !== 'num') throw new Error(ins.op + ': bad operand'); return a[i].v; };
          switch (ins.op){
            case 'q': stack.push(gs); gs = {...gs}; break;
            case 'Q': if (stack.length) gs = stack.pop(); break;
            case 'cm': gs.ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], gs.ctm); break;
            case 'BT': tm = tlm = ID; break;
            case 'Tf': gs.font = fontOf(res, a[0] && a[0].v); gs.size = n(1); break;
            case 'Tc': gs.tc = n(0); break;
            case 'Tw': gs.tw = n(0); break;
            case 'Tz': gs.th = n(0)/100; break;
            case 'TL': gs.tl = n(0); break;
            case 'Ts': gs.rise = n(0); break;
            case 'Tr': gs.tr = n(0); break;
            case 'Td': moveTo(n(0), n(1)); break;
            case 'TD': gs.tl = -n(1); moveTo(n(0), n(1)); break;
            case 'Tm': tm = tlm = [n(0), n(1), n(2), n(3), n(4), n(5)]; break;
            case 'T*': moveTo(0, -gs.tl); break;
            case 'Tj': show(ins, [a[0]], ''); break;
            case 'TJ': if (!a[0] || a[0].t !== 'arr') throw new Error('TJ: bad operand'); show(ins, a[0].v, ''); break;
            case "'": moveTo(0, -gs.tl); show(ins, [a[0]], 'T* '); break;
            case '"': gs.tw = n(0); gs.tc = n(1); moveTo(0, -gs.tl); show(ins, [a[2]], `${fmt(n(0))} Tw ${fmt(n(1))} Tc T* `); break;
            case 'f': case 'F': case 'f*': case 'S': case 's': case 'B': case 'B*': case 'b': case 'b*': case 'sh': stats.paths++; break;
            case 'BMC': mc.push(null); break;
            case 'BDC': mc.push(a[1] && a[1].t === 'dict' ? {ci, dict: a[1], drop: false} : null); break;
            case 'EMC': { const m = mc.pop(); if (m && m.drop) edits[m.ci].push({s: m.dict.s, e: m.dict.e, b: stripAlt(chunks[m.ci], m.dict)}); break; }
            case 'BI': bi = ins; break;
            case 'ID': {
              const get = (...keys) => { for (let i = 0; i + 1 < a.length; i += 2) if (keys.includes(a[i].v) && a[i+1].t === 'num') return a[i+1].v; return 0; };
              image(get('W', 'Width'), get('H', 'Height')); break;
            }
            case 'EI': if (bi && opts.scrubImages) edits[ci].push({s: bi.s, e: ins.e, b: enc(' ')}); bi = null; break;
            case 'Do': {
              const x = a[0] && a[0].t === 'name' ? xobjOf(res, a[0].v) : null;
              if (!x) break;
              const sub = x.o.dict.lookupMaybe(N('Subtype'), P.PDFName);
              if (sub === N('Image')){
                image(num(x.o.dict.get(N('Width'))), num(x.o.dict.get(N('Height'))));
                if (opts.scrubImages){ edits[ci].push({s: ins.s, e: ins.e, b: enc(' ')}); stats.scrubbed.push(x.ref); }
              } else if (sub === N('Form')) form(ins, x);
              break;
            }
          }
        }
      }
      depth--;
      return {edits};
    }

    const raw = node.get(N('Contents'));
    const entries = raw instanceof P.PDFArray ? raw.asArray() : raw ? [raw] : [];
    const streams = entries.map(e => ctx.lookup(e));
    if (streams.some(s => !(s instanceof P.PDFRawStream))) throw new Error('unexpected page contents');
    const chunks = streams.map(s => P.decodePDFRawStream(s).decode());
    const res = ctx.lookupMaybe(node.getInheritableAttribute(N('Resources')), P.PDFDict) || ctx.obj({});
    const {edits} = run(chunks, res, {ctm: ID, font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, tr: 0}, []);
    if (si !== shows.length) throw new Error(`paired ${si} of pdf.js's ${shows.length} text runs`);
    stats.changed = edits.some(e => e.length);
    if (opts.commit && stats.changed){
      node.set(N('Contents'), ctx.obj(entries.map((e, i) => edits[i].length ? ctx.register(ctx.flateStream(splice(chunks[i], edits[i]))) : e)));
      if (opts.scrubImages) node.set(N('Resources'), withoutImages(res));
    }
    return stats;
  }

  /* pdf-lib writes out every object it holds, referenced or not, so a replaced
     content stream would still be in the saved file with the old text in it.
     Drop everything the document no longer reaches. */
  function prune(ctx){
    const seen = new Set(), t = ctx.trailerInfo, todo = [t.Root, t.Info, t.Encrypt, t.ID];
    while (todo.length){
      let o = todo.pop();
      if (!o) continue;
      if (o instanceof P.PDFRef){ if (seen.has(o.tag)) continue; seen.add(o.tag); o = ctx.lookup(o); }
      if (o instanceof P.PDFStream) o = o.dict;
      if (o instanceof P.PDFDict) for (const [, v] of o.entries()) todo.push(v);
      else if (o instanceof P.PDFArray) todo.push(...o.asArray());
    }
    let dropped = 0;
    for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)){ ctx.delete(ref); dropped++; }
    return dropped;
  }

  return {walk, prune, fmt};
})();
