"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/copybook/types.ts
  var CopybookError = class extends Error {
    constructor(code, message, options = {}) {
      super(message);
      __publicField(this, "code");
      __publicField(this, "line");
      __publicField(this, "fields");
      this.name = "CopybookError";
      this.code = code;
      this.line = options.line;
      this.fields = options.fields;
    }
  };

  // src/copybook/compiler.ts
  var FIELD_RE = /^\s*(\d{1,2})\s+([A-Z0-9][A-Z0-9_-]*)\s+(.*)$/;
  var NO_PIC_RE = /^\s*(\d{1,2})\s+([A-Z0-9][A-Z0-9_-]*)\.?\s*$/;
  var NAME_RE = /^[A-Z0-9][A-Z0-9_-]*$/;
  function fail(message, line, code = "COPYBOOK_UNPARSABLE") {
    throw new CopybookError(code, `${message} (copybook line ${line})`, { line });
  }
  function readCount(pic, at) {
    if (pic[at] !== "(") return { count: 1, next: at };
    const close = pic.indexOf(")", at);
    if (close < 0) return { count: 1, next: at };
    const raw = pic.slice(at + 1, close);
    if (!/^\d+$/.test(raw)) return { count: 1, next: at };
    const count = Number(raw);
    return { count, next: close + 1 };
  }
  function parsePicture(raw, line) {
    const pic = raw.replace(/\s+/g, "").toUpperCase().replace(/\.$/, "");
    if (pic.length === 0) fail("empty PICTURE clause", line);
    let i = 0;
    let signed = false;
    if (pic[i] === "S") {
      signed = true;
      i += 1;
    }
    let stringLength = 0;
    let digits = 0;
    let decimals = 0;
    let inDecimals = false;
    let sawX = false;
    let saw9 = false;
    while (i < pic.length) {
      const ch = pic[i];
      if (ch === "X") {
        if (signed) fail(`a signed PICTURE cannot be alphabetic: ${raw}`, line);
        if (inDecimals) fail(`implied decimals require a numeric PICTURE: ${raw}`, line);
        sawX = true;
        const { count, next } = readCount(pic, i + 1);
        if (count < 1) fail(`invalid PICTURE repeat count in ${raw}`, line);
        stringLength += count;
        i = next;
      } else if (ch === "9") {
        saw9 = true;
        const { count, next } = readCount(pic, i + 1);
        if (count < 1) fail(`invalid PICTURE repeat count in ${raw}`, line);
        if (inDecimals) decimals += count;
        else digits += count;
        i = next;
      } else if (ch === "V") {
        if (inDecimals) fail(`duplicate V in PICTURE ${raw}`, line);
        inDecimals = true;
        i += 1;
      } else {
        fail(`unsupported PICTURE symbol "${ch}" in ${raw}`, line);
      }
    }
    if (sawX && saw9) fail(`mixed alphabetic/numeric PICTURE ${raw}`, line);
    if (sawX) return { kind: "string", stringLength: stringLength || 1, signed: false, digits: 0, decimals: 0 };
    if (!saw9) fail(`no data characters in PICTURE ${raw}`, line);
    return { kind: "numeric", stringLength: 0, signed, digits, decimals };
  }
  var REDEFINES_RE = /\sREDEFINES\s+(?:IS\s+)?([A-Z0-9][A-Z0-9_-]*)\b/i;
  function parseGroupClauses(raw, line) {
    let rest = ` ${raw.replace(/\s+/g, " ").trim()} `;
    let redefines;
    const match = REDEFINES_RE.exec(rest);
    if (match) {
      redefines = (match[1] ?? "").toUpperCase();
      rest = rest.replace(REDEFINES_RE, " ");
    }
    rest = rest.trim().replace(/\.$/, "").trim();
    if (rest.length > 0) fail(`unrecognised clause "${rest}" on a group item`, line);
    return { ...redefines ? { redefines } : {} };
  }
  function parseClauses(raw, line) {
    let rest = ` ${raw.replace(/\s+/g, " ").trim()} `;
    const result = { usage: "display" };
    const redefinesMatch = REDEFINES_RE.exec(rest);
    if (redefinesMatch) {
      result.redefines = (redefinesMatch[1] ?? "").toUpperCase();
      rest = rest.replace(REDEFINES_RE, " ");
    }
    const unsupported = [
      [/\sOCCURS\b/i, "OCCURS (fixed or DEPENDING ON)"],
      [/\s(COMP|COMPUTATIONAL|COMP-1|COMP-2|COMPUTATIONAL-1|COMPUTATIONAL-2|BINARY|INDEX)(?![0-9-])/i, "binary COMP usage"]
    ];
    const usageRe = /\sUSAGE\s+(?:IS\s+)?(DISPLAY|COMP-3|COMPUTATIONAL-3|PACKED-DECIMAL|COMP|COMPUTATIONAL|BINARY|COMP-1|COMP-2)\b/i;
    const usageMatch = usageRe.exec(rest);
    if (usageMatch) {
      const token = (usageMatch[1] ?? "").toUpperCase();
      if (token === "DISPLAY") result.usage = "display";
      else if (token === "COMP-3" || token === "COMPUTATIONAL-3" || token === "PACKED-DECIMAL") result.usage = "comp-3";
      else {
        throw new CopybookError("UNSUPPORTED_STRUCTURE", `USAGE ${token} is outside the supported copybook dialect (copybook line ${line})`, { line });
      }
      rest = rest.replace(usageRe, " ");
    }
    for (const [re, label] of unsupported) {
      if (re.test(rest)) {
        throw new CopybookError("UNSUPPORTED_STRUCTURE", `${label} is outside the supported copybook dialect (copybook line ${line})`, { line });
      }
    }
    const packedRe = /\s(COMP-3|COMPUTATIONAL-3|PACKED-DECIMAL)\b/i;
    if (packedRe.test(rest)) {
      result.usage = "comp-3";
      rest = rest.replace(packedRe, " ");
    }
    const signRe = /\sSIGN\s+(?:IS\s+)?(LEADING|TRAILING)(?:\s+(SEPARATE|OVERPUNCH))?\b/i;
    const signMatch = signRe.exec(rest);
    if (signMatch) {
      const position = (signMatch[1] ?? "").toUpperCase();
      const kind = (signMatch[2] ?? "SEPARATE").toUpperCase();
      if (kind === "OVERPUNCH") {
        if (position === "LEADING") {
          throw new CopybookError("UNSUPPORTED_STRUCTURE", `SIGN LEADING OVERPUNCH is outside the supported copybook dialect (copybook line ${line})`, { line });
        }
        result.sign = "trailing-overpunch";
      } else {
        result.sign = position === "LEADING" ? "leading-separate" : "trailing-separate";
      }
      rest = rest.replace(signRe, " ");
    } else if (/\sSIGN\b/i.test(rest)) {
      fail("SIGN clause without LEADING/TRAILING is ambiguous", line);
    }
    const positionRe = /\s(?:POSITION|OFFSET)\s+(?:IS\s+)?(\d+)\b/i;
    const positionMatch = positionRe.exec(rest);
    if (positionMatch) {
      result.position = Number(positionMatch[1]);
      if (result.position < 1) fail("POSITION must be 1-based", line);
      rest = rest.replace(positionRe, " ");
    }
    rest = rest.replace(/\sVALUE\s+(?:IS\s+)?.+$/i, " ").replace(/\sPLAY\s+IS\s+\S+/i, " ");
    rest = rest.trim().replace(/\.$/, "").trim();
    if (rest.length > 0) fail(`unrecognised clause "${rest}"`, line);
    return result;
  }
  function directiveValues(body, line, allowBare = false) {
    const out = {};
    for (const token of body.trim().split(/\s+/)) {
      if (!token) continue;
      const eq = token.indexOf("=");
      if (eq <= 0) {
        if (allowBare) {
          out[""] = token;
          continue;
        }
        fail(`directive flag "${token}" is not key=value`, line);
      }
      out[token.slice(0, eq).toLowerCase()] = token.slice(eq + 1);
    }
    return out;
  }
  function numericWidth(picture, usage, sign) {
    const digitCount = picture.digits + picture.decimals;
    if (usage === "comp-3") return Math.ceil((digitCount + 1) / 2);
    const separate = sign === "leading-separate" || sign === "trailing-separate" ? 1 : 0;
    return digitCount + separate;
  }
  function compileCopybook(text) {
    if (/[\u0080-\u00ff]/.test(text)) {
      throw new CopybookError(
        "UNSUPPORTED_STRUCTURE",
        "this copybook contains non-ASCII bytes, so it is probably EBCDIC; \u300C820\u300D reads ASCII transliterations only"
      );
    }
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const fields = [];
    const notes = [];
    const semantics = {};
    const regions = /* @__PURE__ */ new Map();
    const viewRules = /* @__PURE__ */ new Map();
    let control;
    let framing = "line";
    let recordName = "";
    const frames = [];
    let cursor = 1;
    const closeFrames = (level) => {
      while (frames.length > 0 && frames[frames.length - 1].level >= level) {
        const frame = frames.pop();
        const contentLength = cursor - frame.start;
        if (contentLength < 1) {
          throw new CopybookError(
            "COPYBOOK_REDEFINES",
            `group item ${frame.name} declares no fields, so its width is zero (copybook line ${frame.group.line})`,
            { line: frame.group.line, fields: [frame.name] }
          );
        }
        frame.group.length = contentLength;
        if (frame.regionEnd !== void 0) {
          if (contentLength > frame.regionEnd - frame.start) {
            throw new CopybookError(
              "COPYBOOK_REDEFINES",
              `${frame.name} is ${contentLength} bytes, wider than the ${frame.regionEnd - frame.start} bytes it redefines (copybook line ${frame.group.line})`,
              { line: frame.group.line, fields: [frame.name] }
            );
          }
          cursor = Math.max(cursor, frame.regionEnd);
        }
      }
    };
    const registerInLayout = (regionName, layoutName, fieldName) => {
      const region = regions.get(regionName);
      const list = region.layouts.get(layoutName);
      if (list) list.push(fieldName);
      else region.layouts.set(layoutName, [fieldName]);
    };
    const regionFor = (redefined, line) => {
      const existing = regions.get(redefined.name);
      if (existing) return existing;
      const region = { name: redefined.name, start: redefined.start, length: redefined.length, layouts: /* @__PURE__ */ new Map() };
      regions.set(redefined.name, region);
      const rangeStart = redefined.start;
      const rangeEnd = redefined.start + redefined.length;
      for (const field of fields) {
        if (field.group && frames.some((frame) => frame.name === field.name)) continue;
        const enclosingGroup = field.group === true && field.name !== redefined.name && field.start <= rangeStart && field.start + field.length >= rangeEnd;
        if (enclosingGroup) continue;
        if (field.start >= rangeStart && field.start + field.length <= rangeEnd) {
          field.region ?? (field.region = redefined.name);
          field.layout ?? (field.layout = redefined.name);
          if (field.region === redefined.name) registerInLayout(redefined.name, redefined.name, field.name);
        }
      }
      if (!region.layouts.has(redefined.name)) {
        throw new CopybookError(
          "COPYBOOK_REDEFINES",
          `REDEFINES ${redefined.name} names an item with no fields inside it (copybook line ${line})`,
          { line }
        );
      }
      return region;
    };
    const directiveValuesFor = (name2, body, line) => directiveValues(body, line, name2.toLowerCase() === "framing");
    lines.forEach((lineText, idx) => {
      const line = idx + 1;
      const trimmed = lineText.trim();
      if (trimmed.length === 0) return;
      if (trimmed.startsWith("*")) {
        const body = trimmed.slice(1).trim();
        if (!body.startsWith("@")) return;
        const [name3 = "", ...rest] = body.split(/\s+/);
        const values = directiveValuesFor(name3.slice(1), rest.join(" "), line);
        switch (name3.slice(1).toLowerCase()) {
          case "semantics": {
            if (values.amount) semantics.amount = values.amount.toUpperCase();
            if (values.currency) semantics.currency = values.currency.toUpperCase();
            if (values.valuedate) semantics.valueDate = values.valuedate.toUpperCase();
            if (values.dateformat) {
              const fmt = values.dateformat.toUpperCase();
              if (fmt !== "CCYYMMDD" && fmt !== "YYMMDD") fail(`unsupported dateFormat ${values.dateformat} (use CCYYMMDD or YYMMDD)`, line);
              semantics.dateFormat = fmt;
            }
            if (values.reference) semantics.reference = values.reference.toUpperCase();
            if (values.transactiontype) semantics.transactionType = values.transactiontype.toUpperCase();
            if (values.creditvalue) semantics.creditValue = values.creditvalue;
            if (values.debitvalue) semantics.debitValue = values.debitvalue;
            return;
          }
          case "control": {
            const typeField = values.typefield?.toUpperCase();
            const trailerValue = values.trailervalue;
            if (!typeField || trailerValue === void 0) fail("@control requires typeField and trailerValue", line);
            control = {
              typeField,
              trailerValue,
              ...values.countfield ? { countField: values.countfield.toUpperCase() } : {},
              ...values.totalfield ? { totalField: values.totalfield.toUpperCase() } : {},
              ...values.currencyfield ? { currencyField: values.currencyfield.toUpperCase() } : {}
            };
            return;
          }
          case "framing": {
            const mode = (values.mode ?? values[""] ?? rest.join(" ")).trim().toLowerCase();
            if (mode !== "line" && mode !== "fixed") fail(`@framing must be line or fixed, got "${mode}"`, line);
            framing = mode;
            return;
          }
          case "view": {
            const layout = values.layout?.toUpperCase();
            const typeField = (values.typefield ?? values.discriminator)?.toUpperCase();
            const rawValues = values.value ?? values.values;
            if (!layout || !typeField || rawValues === void 0) {
              fail("@view requires layout, typeField and value (e.g. `@view layout=TRAILER typeField=REC-TYPE value=T`)", line);
            }
            const list = rawValues.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
            if (list.length === 0) fail(`@view ${layout} declares no value`, line);
            viewRules.set(layout, { typeField, values: list });
            return;
          }
          default:
            notes.push(`copybook line ${line}: directive @${name3.slice(1)} ignored`);
            return;
        }
      }
      const hasPic = /PIC\s+/i.test(lineText);
      let level;
      let name2;
      let remainder = "";
      let clauses = { usage: "display" };
      const bare = hasPic ? null : NO_PIC_RE.exec(lineText);
      if (bare) {
        level = Number(bare[1]);
        name2 = bare[2];
        if (level === 1) {
          recordName = name2;
          return;
        }
        if (level === 88) return;
      } else {
        const match = FIELD_RE.exec(lineText);
        if (!match) fail(`line is not a field definition: "${lineText.trim()}"`, line);
        level = Number(match[1]);
        name2 = match[2];
        remainder = match[3];
        if (!NAME_RE.test(name2)) fail(`invalid field name "${name2}"`, line);
        if (!hasPic) {
          const groupClauses = parseGroupClauses(remainder, line);
          clauses = { usage: "display", ...groupClauses };
        }
      }
      closeFrames(level);
      let picture;
      if (hasPic) {
        const picIndex = remainder.search(/PIC\s+/i);
        if (picIndex < 0) fail(`field ${name2} has no PIC clause`, line);
        const afterPic = remainder.slice(picIndex).replace(/^PIC\s+/i, "");
        const picTokenMatch = /^(\S+?)\.?(\s|$)/.exec(afterPic);
        if (!picTokenMatch) fail(`field ${name2} has an empty PIC clause`, line);
        const picToken = (picTokenMatch[1] ?? "").replace(/\.$/, "");
        picture = parsePicture(picToken, line);
        clauses = parseClauses(afterPic.slice(picTokenMatch[0].length), line);
        if (picture.kind === "string" && clauses.usage === "comp-3") fail(`COMP-3 requires a numeric PICTURE (field ${name2})`, line);
        if (picture.kind === "string" && clauses.sign) fail(`SIGN requires a numeric PICTURE (field ${name2})`, line);
        if (picture.kind === "numeric" && clauses.usage === "display" && (picture.signed || clauses.sign) && !clauses.sign) {
          fail(`signed field ${name2} must declare its sign convention (SIGN LEADING/ TRAILING SEPARATE or SIGN TRAILING OVERPUNCH)`, line);
        }
      }
      let redefined;
      if (clauses.redefines) {
        redefined = fields.find((field2) => field2.name === clauses.redefines);
        if (!redefined) {
          throw new CopybookError(
            "COPYBOOK_REDEFINES",
            `REDEFINES names ${clauses.redefines}, which is not declared before this line (copybook line ${line})`,
            { line }
          );
        }
        if (redefined.level !== level) {
          throw new CopybookError(
            "COPYBOOK_REDEFINES",
            `REDEFINES ${redefined.name} must be at the same level-number (${redefined.level}), not ${level} (copybook line ${line})`,
            { line, fields: [redefined.name, name2] }
          );
        }
        if (frames.some((frame) => frame.name === redefined.name)) {
          throw new CopybookError(
            "COPYBOOK_REDEFINES",
            `REDEFINES ${redefined.name} names a group that is still open, so its width is not known yet (copybook line ${line})`,
            { line, fields: [redefined.name, name2] }
          );
        }
        if (redefined.length < 1) {
          throw new CopybookError(
            "COPYBOOK_REDEFINES",
            `REDEFINES ${redefined.name} names an item with no width (copybook line ${line})`,
            { line }
          );
        }
        regionFor(redefined, line);
      }
      const parent = frames[frames.length - 1];
      const start = clauses.position ?? (redefined ? redefined.start : cursor);
      if (!hasPic && clauses.position !== void 0) fail(`group item ${name2} cannot declare POSITION`, line);
      if (!picture) {
        const group = {
          name: name2,
          level,
          start,
          length: 0,
          type: "string",
          pic: "GROUP",
          signed: false,
          usage: "display",
          explicitPosition: false,
          line,
          group: true,
          ...redefined ? { redefines: redefined.name } : {}
        };
        if (redefined) {
          group.region = redefined.name;
          group.layout = name2;
        } else if (parent?.region) {
          group.region = parent.region;
          group.layout = parent.layout;
        }
        if (group.region) registerInLayout(group.region, group.layout, name2);
        fields.push(group);
        cursor = start;
        frames.push({
          name: name2,
          level,
          start,
          group,
          ...group.region ? { region: group.region, layout: group.layout } : {},
          ...redefined ? { regionEnd: redefined.start + redefined.length } : {}
        });
        return;
      }
      const signed = picture.signed || clauses.sign !== void 0;
      const usage = clauses.usage;
      let type;
      if (name2 === "FILLER") type = "filler";
      else if (picture.kind === "string") type = "string";
      else if (usage === "comp-3") type = "packed-decimal";
      else if (clauses.sign === "trailing-overpunch") type = "zoned-decimal";
      else if (signed) type = "signed-int";
      else if (picture.decimals > 0) type = "implied-decimal";
      else type = "unsigned-int";
      const length = picture.kind === "string" ? picture.stringLength : numericWidth(picture, usage, clauses.sign);
      if (redefined && length > redefined.length) {
        throw new CopybookError(
          "COPYBOOK_REDEFINES",
          `${name2} is ${length} bytes, wider than the ${redefined.length} bytes it redefines (${redefined.name}) (copybook line ${line})`,
          { line, fields: [redefined.name, name2] }
        );
      }
      const normalisedPic = picture.kind === "string" ? `X(${picture.stringLength})` : `${picture.signed ? "S" : ""}9(${picture.digits})${picture.decimals > 0 ? `V${"9".repeat(picture.decimals)}` : ""}`;
      const field = {
        name: name2,
        level,
        start,
        length,
        type,
        pic: normalisedPic,
        ...picture.kind === "numeric" ? { digits: picture.digits, decimals: picture.decimals } : {},
        signed,
        ...clauses.sign ? { sign: clauses.sign } : {},
        usage,
        explicitPosition: clauses.position !== void 0,
        line,
        ...redefined ? { redefines: redefined.name } : {}
      };
      if (redefined) {
        field.region = redefined.name;
        field.layout = name2;
      } else if (parent?.region) {
        field.region = parent.region;
        field.layout = parent.layout;
      }
      if (field.region) registerInLayout(field.region, field.layout, field.name);
      fields.push(field);
      cursor = start + length;
      if (redefined) cursor = redefined.start + redefined.length;
    });
    closeFrames(0);
    if (!fields.some((field) => !field.group)) {
      throw new CopybookError("COPYBOOK_UNPARSABLE", "copybook declares no fields");
    }
    const leaves = fields.filter((field) => !field.group);
    for (let i = 0; i < leaves.length; i += 1) {
      for (let j = i + 1; j < leaves.length; j += 1) {
        const a = leaves[i];
        const b = leaves[j];
        const overlaps = a.start < b.start + b.length && b.start < a.start + a.length;
        if (!overlaps) continue;
        const sharedRegion = a.region !== void 0 && a.region === b.region && a.layout !== b.layout;
        if (sharedRegion) continue;
        throw new CopybookError(
          "COPYBOOK_OVERLAP",
          `fields ${a.name} (bytes ${a.start}-${a.start + a.length - 1}) and ${b.name} (bytes ${b.start}-${b.start + b.length - 1}) overlap (copybook line ${b.line})`,
          { line: b.line, fields: [a.name, b.name] }
        );
      }
    }
    const intervals = fields.map((field) => [field.start, field.start + field.length - 1]).sort((x, y) => x[0] - y[0]);
    let covered = 0;
    for (const [start, end] of intervals) {
      if (start > covered + 1) notes.push(`bytes ${covered + 1}-${start - 1} are not covered by any field`);
      covered = Math.max(covered, end);
    }
    const recordLength = Math.max(...fields.map((field) => field.start + field.length - 1));
    const fieldOf = (name2, key) => {
      const field = fields.find((entry) => entry.name === name2 && !entry.group);
      if (!field) {
        throw new CopybookError("COPYBOOK_SEMANTICS", `@${key} names ${name2}, which is not a field in this copybook`);
      }
      return field;
    };
    for (const key of ["amount", "currency", "valueDate", "reference", "transactionType"]) {
      const name2 = semantics[key];
      if (!name2) continue;
      const field = fieldOf(name2, `semantics ${key}`);
      if (key === "currency" || key === "reference" || key === "transactionType") {
        if (field.type !== "string") {
          throw new CopybookError("COPYBOOK_SEMANTICS", `@semantics ${key}=${name2} must name an alphabetic field, but ${name2} is ${field.type}`);
        }
      } else if (key === "amount") {
        if (field.type === "string" || field.type === "filler") {
          throw new CopybookError("COPYBOOK_SEMANTICS", `@semantics amount=${name2} must name a numeric field, but ${name2} is ${field.type}`);
        }
      } else if (field.type === "string" || field.type === "filler") {
        throw new CopybookError("COPYBOOK_SEMANTICS", `@semantics valueDate=${name2} must name a numeric field, but ${name2} is ${field.type}`);
      }
    }
    if (control) {
      const typeField = fieldOf(control.typeField, "control typeField");
      if (typeField.type !== "string") {
        throw new CopybookError("COPYBOOK_SEMANTICS", `@control typeField=${control.typeField} must be alphabetic`);
      }
      if (control.countField) fieldOf(control.countField, "control countField");
      if (control.totalField) fieldOf(control.totalField, "control totalField");
      if (control.currencyField) fieldOf(control.currencyField, "control currencyField");
    }
    const views = [];
    for (const region of regions.values()) {
      for (const [layoutName, layoutFieldNames] of region.layouts) {
        const rule = viewRules.get(layoutName);
        if (!rule) {
          throw new CopybookError(
            "COPYBOOK_SEMANTICS",
            `REDEFINES layout ${layoutName} has no activation rule: add '* @view layout=${layoutName} typeField=<field> value=<value>' naming the record type that selects it`
          );
        }
        views.push({
          region: region.name,
          layout: layoutName,
          start: region.start,
          length: region.length,
          fields: [...layoutFieldNames],
          typeField: rule.typeField,
          values: rule.values
        });
      }
    }
    if (views.length > 0) {
      for (const view of views) {
        const typeField = fields.find((field) => field.name === view.typeField && !field.group);
        if (!typeField) {
          throw new CopybookError("COPYBOOK_SEMANTICS", `@view ${view.layout} names typeField=${view.typeField}, which is not a field`);
        }
        if (typeField.type !== "string") {
          throw new CopybookError("COPYBOOK_SEMANTICS", `@view ${view.layout} typeField=${view.typeField} must be alphabetic`);
        }
        if (typeField.region !== void 0) {
          throw new CopybookError(
            "COPYBOOK_SEMANTICS",
            `@view ${view.layout} typeField=${view.typeField} sits inside a REDEFINES region, so it cannot choose the layout`
          );
        }
      }
      const selected = /* @__PURE__ */ new Map();
      for (const view of views) {
        for (const value of view.values ?? []) {
          const key = `${view.typeField}\0${value}`;
          const previous = selected.get(key);
          if (previous && previous !== view.layout) {
            throw new CopybookError(
              "COPYBOOK_SEMANTICS",
              `@view: value ${value} of ${view.typeField} selects both ${previous} and ${view.layout}`
            );
          }
          selected.set(key, view.layout);
        }
      }
    } else if (viewRules.size > 0) {
      const unknown = [...viewRules.keys()][0];
      throw new CopybookError(
        "COPYBOOK_SEMANTICS",
        `@view layout=${unknown} does not name a layout of any REDEFINES region in this copybook`
      );
    }
    for (const region of regions.values()) {
      const layouts = [...region.layouts.keys()];
      if (layouts.length < 2) {
        const only = layouts[0] ?? region.name;
        throw new CopybookError(
          "COPYBOOK_REDEFINES",
          `REDEFINES region ${region.name} has one layout (${only}) and describes nothing; remove the clause or add the redefining item`
        );
      }
    }
    if (semantics.amount && !semantics.currency) {
      notes.push("@semantics declares an amount but no currency field: amounts will carry an empty currency");
    }
    if (!semantics.amount && !semantics.reference) {
      notes.push("no @semantics amount/reference declared: this copybook parses records but cannot be reconciled");
    }
    const name = recordName || "RECORD";
    return {
      name,
      recordLength,
      fields,
      semantics,
      ...control ? { control } : {},
      framing,
      ...views.length > 0 ? { views } : {},
      notes,
      source: text.replace(/\r\n/g, "\n")
    };
  }

  // src/static/sha256-browser.ts
  var K = new Uint32Array([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  function rotr(value, bits) {
    return value >>> bits | value << 32 - bits;
  }
  function utf8Bytes(text) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
    const out = [];
    for (let index = 0; index < text.length; index += 1) {
      let code = text.charCodeAt(index);
      if (code >= 55296 && code <= 56319 && index + 1 < text.length) {
        const low = text.charCodeAt(index + 1);
        if (low >= 56320 && low <= 57343) {
          code = 65536 + (code - 55296 << 10) + (low - 56320);
          index += 1;
        }
      }
      if (code < 128) out.push(code);
      else if (code < 2048) out.push(192 | code >> 6, 128 | code & 63);
      else if (code < 65536) out.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
      else out.push(240 | code >> 18, 128 | code >> 12 & 63, 128 | code >> 6 & 63, 128 | code & 63);
    }
    return Uint8Array.from(out);
  }
  function sha256Hex(data) {
    const message = typeof data === "string" ? utf8Bytes(data) : data;
    const length = message.length;
    const bitLength = length * 8;
    const blockCount = Math.floor((length + 8) / 64) + 1;
    const total = blockCount * 64;
    const padded = new Uint8Array(total);
    padded.set(message);
    padded[length] = 128;
    const view = new DataView(padded.buffer);
    view.setUint32(total - 8, Math.floor(bitLength / 4294967296));
    view.setUint32(total - 4, bitLength >>> 0);
    const h = new Uint32Array([
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ]);
    const w = new Uint32Array(64);
    for (let block = 0; block < blockCount; block += 1) {
      const offset = block * 64;
      for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i += 1) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
        w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]];
      for (let i = 0; i < 64; i += 1) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = e & f ^ ~e & g;
        const temp1 = hh + S1 + ch + K[i] + w[i] >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = a & b ^ a & c ^ b & c;
        const temp2 = S0 + maj >>> 0;
        hh = g;
        g = f;
        f = e;
        e = d + temp1 >>> 0;
        d = c;
        c = b;
        b = a;
        a = temp1 + temp2 >>> 0;
      }
      h[0] = h[0] + a >>> 0;
      h[1] = h[1] + b >>> 0;
      h[2] = h[2] + c >>> 0;
      h[3] = h[3] + d >>> 0;
      h[4] = h[4] + e >>> 0;
      h[5] = h[5] + f >>> 0;
      h[6] = h[6] + g >>> 0;
      h[7] = h[7] + hh >>> 0;
    }
    let hex = "";
    for (const word of h) hex += word.toString(16).padStart(8, "0");
    return hex;
  }
  function createHash(_algorithm) {
    let data = new Uint8Array(0);
    let pending = [];
    return {
      update(chunk) {
        if (typeof chunk === "string") pending.push(utf8Bytes(chunk));
        else pending.push(chunk);
        return this;
      },
      digest(encoding = "hex") {
        const total = pending.reduce((sum, part) => sum + part.length, 0);
        const joined = new Uint8Array(total);
        let offset = 0;
        for (const part of pending) {
          joined.set(part, offset);
          offset += part.length;
        }
        pending = [];
        data = joined;
        const hex = sha256Hex(data);
        if (encoding === "hex") return hex;
        return hex;
      }
    };
  }

  // src/core/bytes.ts
  function toLatin1(bytes) {
    let out = "";
    const chunk = 32768;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      out += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return out;
  }
  function fromLatin1(text) {
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      bytes[index] = code > 255 ? 63 : code;
    }
    return bytes;
  }
  function isBytes(value) {
    return value instanceof Uint8Array;
  }

  // src/parser/decode.ts
  var OVERPUNCH_POSITIVE = { "{": 0 };
  var OVERPUNCH_NEGATIVE = { "}": 0 };
  for (let d = 1; d <= 9; d += 1) {
    OVERPUNCH_POSITIVE[String.fromCharCode("A".charCodeAt(0) + d - 1)] = d;
    OVERPUNCH_NEGATIVE[String.fromCharCode("J".charCodeAt(0) + d - 1)] = d;
  }
  var FieldDecodeError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "FieldDecodeError";
    }
  };
  var DIGITS_ONLY = /^[0-9]+$/;
  function digitsToBigInt(digits, context) {
    if (!DIGITS_ONLY.test(digits)) {
      throw new FieldDecodeError(`${context}: expected digits, found ${JSON.stringify(digits)}`);
    }
    return BigInt(digits);
  }
  function decodeZonedDecimal(raw, field) {
    if (raw.length === 0) throw new FieldDecodeError(`${field.name}: empty value`);
    const last = raw[raw.length - 1];
    const head = raw.slice(0, -1);
    let digit;
    let negative = false;
    if (DIGITS_ONLY.test(last)) {
      digit = Number(last);
    } else if (last in OVERPUNCH_POSITIVE) {
      digit = OVERPUNCH_POSITIVE[last];
    } else if (last in OVERPUNCH_NEGATIVE) {
      digit = OVERPUNCH_NEGATIVE[last];
      negative = true;
    } else {
      throw new FieldDecodeError(`${field.name}: ${JSON.stringify(last)} is not in the overpunch table`);
    }
    const magnitude = digitsToBigInt(`${head}${digit}`, field.name);
    return negative && magnitude !== 0n ? -magnitude : magnitude;
  }
  function decodeSeparateSign(raw, field) {
    const convention = field.sign ?? "trailing-separate";
    let signChar = "";
    let digits = "";
    if (convention === "leading-separate") {
      signChar = raw.slice(0, 1);
      digits = raw.slice(1);
    } else {
      signChar = raw.slice(-1);
      digits = raw.slice(0, -1);
    }
    if (signChar !== "+" && signChar !== "-" && signChar !== " ") {
      if (DIGITS_ONLY.test(raw)) throw new FieldDecodeError(`${field.name}: missing separate sign`);
      throw new FieldDecodeError(`${field.name}: invalid separate sign ${JSON.stringify(signChar)}`);
    }
    const magnitude = digitsToBigInt(digits, field.name);
    return signChar === "-" && magnitude !== 0n ? -magnitude : magnitude;
  }
  function decodePackedDecimal(raw, field) {
    if (raw.length === 0) throw new FieldDecodeError(`${field.name}: empty packed value`);
    const nibbles = [];
    for (let i = 0; i < raw.length; i += 1) {
      const byte = raw.charCodeAt(i);
      nibbles.push(byte >> 4, byte & 15);
    }
    const signNibble = nibbles.pop();
    let negative = false;
    if (signNibble === 12 || signNibble === 15) negative = false;
    else if (signNibble === 13) negative = true;
    else throw new FieldDecodeError(`${field.name}: invalid packed sign nibble 0x${signNibble.toString(16)}`);
    const digitCount = (field.digits ?? 0) + (field.decimals ?? 0);
    if (nibbles.length < digitCount) {
      throw new FieldDecodeError(`${field.name}: packed value holds ${nibbles.length} nibbles but the copybook declares ${digitCount} digits`);
    }
    const padding = nibbles.slice(0, nibbles.length - digitCount);
    for (const nib of padding) {
      if (nib !== 0) throw new FieldDecodeError(`${field.name}: packed padding nibble 0x${nib.toString(16)} is not zero`);
    }
    let digits = "";
    for (const nib of nibbles.slice(nibbles.length - digitCount)) {
      if (nib > 9) throw new FieldDecodeError(`${field.name}: packed digit nibble 0x${nib.toString(16)} is not a digit`);
      digits += String(nib);
    }
    const magnitude = BigInt(digits.length === 0 ? "0" : digits);
    return negative && magnitude !== 0n ? -magnitude : magnitude;
  }
  function decodeUnsignedInt(raw, field) {
    return digitsToBigInt(raw, field.name);
  }
  function decodeDate(raw, field, format = "CCYYMMDD") {
    const expected = format === "CCYYMMDD" ? 8 : 6;
    if (!DIGITS_ONLY.test(raw) || raw.length !== expected) {
      throw new FieldDecodeError(`${field.name}: expected a ${expected}-digit ${format} date, found ${JSON.stringify(raw)}`);
    }
    const year = format === "CCYYMMDD" ? Number(raw.slice(0, 4)) : 2e3 + Number(raw.slice(0, 2));
    const month = Number(raw.slice(format === "CCYYMMDD" ? 4 : 2, format === "CCYYMMDD" ? 6 : 4));
    const day = Number(raw.slice(format === "CCYYMMDD" ? 6 : 4));
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      throw new FieldDecodeError(`${field.name}: ${raw} is not a calendar date`);
    }
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // src/parser/parser.ts
  var CURRENCY_EXPONENTS = {
    USD: 2,
    EUR: 2,
    GBP: 2,
    CHF: 2,
    CAD: 2,
    AUD: 2,
    CNY: 2,
    SGD: 2,
    JPY: 0,
    KRW: 0
  };
  function sha256(data) {
    return createHash("sha256").update(data).digest("hex");
  }
  function splitRecords(source, recordLength, framing) {
    const text = toLatin1(source);
    if (framing === "fixed") {
      const records = [];
      for (let offset = 0; offset < text.length; offset += recordLength) {
        records.push(text.slice(offset, offset + recordLength));
      }
      return { records, eol: null, trailingNewline: false };
    }
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    if (text.length === 0) return { records: [], eol: null, trailingNewline: false };
    const trailingNewline = text.endsWith(eol);
    const parts = text.split(eol);
    if (trailingNewline) parts.pop();
    return { records: parts, eol, trailingNewline };
  }
  function decodeField(field, slice, dateFormat) {
    switch (field.type) {
      case "filler":
        return null;
      case "string":
        return slice;
      case "zoned-decimal":
        return decodeZonedDecimal(slice, field);
      case "signed-int":
        return decodeSeparateSign(slice, field);
      case "packed-decimal":
        return decodePackedDecimal(slice, field);
      case "implied-decimal":
      case "unsigned-int":
        return decodeUnsignedInt(slice, field);
      default:
        throw new FieldDecodeError(`${field.name}: unsupported field type ${String(field.type)}`);
    }
  }
  function parseFile(input) {
    var _a, _b;
    const { copybook } = input;
    if (!copybook.recordLength || copybook.recordLength < 1) {
      throw new Error("copybook declares a record length of zero  -  refusing to parse");
    }
    const source = isBytes(input.source) ? input.source : fromLatin1(input.source);
    const { records: rawRecords, eol, trailingNewline } = splitRecords(source, copybook.recordLength, copybook.framing);
    const issues = [];
    const records = [];
    const dateFormat = copybook.semantics.dateFormat ?? "CCYYMMDD";
    const activeLayouts = (raw, index, issuesOut) => {
      const active = {};
      if (!copybook.views || copybook.views.length === 0) return active;
      const regions = /* @__PURE__ */ new Map();
      for (const view of copybook.views) {
        const list = regions.get(view.region);
        if (list) list.push(view);
        else regions.set(view.region, [view]);
      }
      for (const [regionName, layouts] of regions) {
        const hits = [];
        for (const layout of layouts) {
          const discriminator2 = layout.typeField ? copybook.fields.find((field) => field.name === layout.typeField) : void 0;
          if (!discriminator2) continue;
          const value = raw.slice(discriminator2.start - 1, discriminator2.start - 1 + discriminator2.length).trim();
          if ((layout.values ?? []).some((candidate) => candidate === value)) hits.push(layout.layout);
        }
        if (hits.length === 1) {
          active[regionName] = hits[0];
          continue;
        }
        const discriminatorName = layouts[0]?.typeField ?? "(none)";
        const discriminator = copybook.fields.find((field) => field.name === discriminatorName);
        const seen = discriminator ? raw.slice(discriminator.start - 1, discriminator.start - 1 + discriminator.length).trim() : "";
        const declared = layouts.map((layout) => `${layout.layout}=${(layout.values ?? []).join("/")}`).join(", ");
        issuesOut.push({
          code: "REDEFINES_VIEW_UNMATCHED",
          recordIndex: index,
          field: discriminatorName,
          actual: seen,
          detail: hits.length === 0 ? `record ${index}: ${discriminatorName} reads ${JSON.stringify(seen)}, which selects no layout of the shared bytes ${regionName} (declared: ${declared})` : `record ${index}: ${discriminatorName} reads ${JSON.stringify(seen)}, which selects more than one layout (${hits.join(", ")})`
        });
      }
      return active;
    };
    rawRecords.forEach((raw, index) => {
      const recordIssues = [];
      if (raw.length !== copybook.recordLength) {
        const issue = {
          code: "RECORD_LENGTH_MISMATCH",
          recordIndex: index,
          declared: copybook.recordLength,
          actual: raw.length,
          detail: `record ${index} is ${raw.length} bytes but the copybook declares ${copybook.recordLength}`
        };
        recordIssues.push(issue);
      }
      const values = {};
      const slices = {};
      const views = activeLayouts(raw, index, recordIssues);
      for (const field of copybook.fields) {
        if (field.group) continue;
        if (field.region !== void 0) {
          const active = views[field.region];
          if (active !== field.layout) continue;
        }
        const slice = raw.slice(field.start - 1, field.start - 1 + field.length);
        slices[field.name] = slice;
        if (slice.length < field.length) {
          values[field.name] = null;
          continue;
        }
        try {
          values[field.name] = decodeField(field, slice, dateFormat);
        } catch (error) {
          values[field.name] = null;
          if (error instanceof FieldDecodeError) {
            recordIssues.push({
              code: "FIELD_INVALID_NUMERIC",
              recordIndex: index,
              field: field.name,
              actual: slice,
              detail: error.message
            });
          } else {
            throw error;
          }
        }
      }
      const isTrailerRecord = copybook.control ? (slices[copybook.control.typeField] ?? "").trim() === copybook.control.trailerValue : false;
      const amountField = isTrailerRecord && copybook.control?.totalField ? copybook.control.totalField : copybook.semantics.amount;
      const currencyField = isTrailerRecord && copybook.control?.currencyField ? copybook.control.currencyField : copybook.semantics.currency;
      const valueDate = copybook.semantics.valueDate;
      if (amountField) {
        const raw2 = values[amountField];
        const currency = currencyField ? String(values[currencyField] ?? "").trim() : "";
        if (typeof raw2 === "bigint") {
          const field = copybook.fields.find((f) => f.name === amountField);
          values[amountField] = { minorUnits: raw2, currency, scale: field.decimals ?? 0 };
          const expected = CURRENCY_EXPONENTS[currency];
          const scale = field.decimals ?? 0;
          if (expected === void 0) {
            recordIssues.push({
              code: "CURRENCY_SCALE_MISMATCH",
              recordIndex: index,
              field: currencyField,
              actual: currency,
              detail: `${currency === "" ? "(empty)" : currency} is not in the ISO-4217 table, so the copybook's ${scale}-digit scale cannot be verified`
            });
          } else if (expected !== scale) {
            recordIssues.push({
              code: "CURRENCY_SCALE_MISMATCH",
              recordIndex: index,
              field: amountField,
              declared: scale,
              actual: expected,
              detail: `${currency} has ${expected} decimal places but the copybook scales ${amountField} by ${scale}`
            });
          }
        }
      }
      if (valueDate) {
        try {
          const iso = decodeDate(slices[valueDate] ?? "", copybook.fields.find((f) => f.name === valueDate), dateFormat);
          values[`${valueDate}__iso`] = iso;
        } catch {
        }
      }
      const isTrailer = isTrailerRecord;
      issues.push(...recordIssues);
      records.push({
        index,
        raw,
        length: raw.length,
        values,
        slices,
        issues: recordIssues,
        isTrailer,
        ...Object.keys(views).length > 0 ? { views } : {}
      });
    });
    let declaredControl;
    const control = copybook.control;
    if (control) {
      const trailer = records.find((r) => r.isTrailer);
      if (trailer) {
        const declaration = { recordIndex: trailer.index };
        if (control.countField) {
          const raw = trailer.slices[control.countField] ?? "";
          if (/^[0-9]+$/.test(raw)) declaration.count = BigInt(raw);
        }
        if (control.totalField) {
          const total = trailer.values[control.totalField];
          if (total && typeof total === "object") declaration.total = total;
        }
        declaredControl = declaration;
      } else {
        issues.push({
          code: "SPEC_MISSING",
          detail: `the copybook declares a control trailer (${control.typeField}='${control.trailerValue}') but the file has no such record`
        });
      }
    }
    const totalsByCurrency = {};
    const creditTotalsByCurrency = {};
    const debitTotalsByCurrency = {};
    let detailCount = 0;
    for (const record of records) {
      if (record.isTrailer) continue;
      detailCount += 1;
      if (!amountFieldName(copybook)) continue;
      const value = record.values[amountFieldName(copybook)];
      if (!value || typeof value !== "object") continue;
      const bucket = totalsByCurrency[_a = value.currency] ?? (totalsByCurrency[_a] = { minorUnits: 0n, scale: value.scale, records: 0 });
      bucket.minorUnits += value.minorUnits;
      bucket.records += 1;
      const gross = value.minorUnits < 0n ? -value.minorUnits : value.minorUnits;
      const target = value.minorUnits < 0n ? debitTotalsByCurrency : creditTotalsByCurrency;
      const grossBucket = target[_b = value.currency] ?? (target[_b] = { minorUnits: 0n, scale: value.scale, records: 0 });
      grossBucket.minorUnits += gross;
      grossBucket.records += 1;
    }
    const copybookHash = sha256(copybook.source);
    const fileHash = sha256(source);
    const fingerprint = sha256(
      [
        `copybook:${copybookHash}`,
        `file:${fileHash}`,
        `framing:${copybook.framing}`,
        `recordLength:${copybook.recordLength}`,
        `records:${records.map((r) => sha256(r.raw)).join(",")}`,
        `issues:${issues.map((i) => `${i.code}@${i.recordIndex ?? "-"}:${i.field ?? "-"}`).join(",")}`,
        // Only a copybook with `REDEFINES` contributes this component, so a fingerprint
        // of a copybook without views is unchanged by the feature (regression: the six
        // sample scenarios keep the fingerprints they had before).
        ...copybook.views && copybook.views.length > 0 ? [`views:${records.map((r) => r.views ? Object.entries(r.views).map(([k, v]) => `${k}=${v}`).join("+") : "-").join(",")}`] : [],
        declaredControl ? `declared:${declaredControl.count?.toString() ?? "-"}/${declaredControl.total?.minorUnits.toString() ?? "-"}${declaredControl.total?.currency ?? ""}` : "declared:-"
      ].join("|")
    );
    return {
      copybook,
      framing: copybook.framing,
      records,
      issues,
      ...declaredControl ? { declaredControl } : {},
      computedControl: { recordCount: records.length, detailCount, totalsByCurrency, creditTotalsByCurrency, debitTotalsByCurrency },
      eol,
      trailingNewline,
      fileHash,
      copybookHash,
      fingerprint,
      source
    };
  }
  function amountFieldName(copybook) {
    return copybook.semantics.amount;
  }

  // src/bai2/schema.ts
  var BAI2_LAYOUTS = {
    "01": [
      { name: "REC-CODE", index: 1 },
      { name: "SENDER-ID", index: 2 },
      { name: "RECEIVER-ID", index: 3 },
      { name: "FILE-CREATION-DATE", index: 4, note: "YYMMDD" },
      { name: "FILE-CREATION-TIME", index: 5, note: "HHMM" },
      { name: "FILE-ID", index: 6 },
      { name: "PHYSICAL-RECORD-LENGTH", index: 7 },
      { name: "BLOCK-SIZE", index: 8 },
      { name: "VERSION", index: 9, note: "2 for BAI2" }
    ],
    "02": [
      { name: "REC-CODE", index: 1 },
      { name: "ULTIMATE-RECEIVER-ID", index: 2 },
      { name: "ORIGINATOR-ID", index: 3 },
      { name: "GROUP-STATUS", index: 4 },
      { name: "AS-OF-DATE", index: 5, note: "YYMMDD" },
      { name: "AS-OF-TIME", index: 6, note: "HHMM" },
      { name: "CURRENCY", index: 7, note: "ISO-4217" },
      { name: "AS-OF-DATE-MODIFIER", index: 8 }
    ],
    "03": [
      { name: "REC-CODE", index: 1 },
      { name: "ACCOUNT", index: 2 },
      { name: "CURRENCY", index: 3 },
      { name: "TYPE-CODE", index: 4, note: "BAI summary code; 100 = total credits" },
      { name: "AMOUNT", index: 5 },
      { name: "ITEM-COUNT", index: 6 },
      { name: "FUNDS-TYPE", index: 7 }
    ],
    "16": [
      { name: "REC-CODE", index: 1 },
      { name: "TYPE-CODE", index: 2, note: "100-399 credit, 400-699 debit" },
      { name: "AMOUNT", index: 3, note: "unsigned; direction comes from TYPE-CODE" },
      { name: "FUNDS-TYPE", index: 4 },
      { name: "BANK-REF", index: 5 },
      { name: "CUSTOMER-REFERENCE", index: 6 },
      { name: "TEXT", index: 7, note: "free text, may contain commas" }
    ],
    "49": [
      { name: "REC-CODE", index: 1 },
      { name: "ACCOUNT-CONTROL-TOTAL", index: 2 },
      { name: "NUMBER-OF-RECORDS", index: 3, note: "records in the account block, 03..49" },
      { name: "ACCOUNT-CONTROL-TOTAL-B", index: 4 }
    ],
    "88": [{ name: "REC-CODE", index: 1 }, { name: "CONTINUATION", index: 2 }],
    "98": [
      { name: "REC-CODE", index: 1 },
      { name: "GROUP-CONTROL-TOTAL", index: 2 },
      { name: "NUMBER-OF-ACCOUNTS", index: 3 },
      { name: "NUMBER-OF-RECORDS", index: 4, note: "records in the group, 02..98" }
    ],
    "99": [
      { name: "REC-CODE", index: 1 },
      { name: "FILE-CONTROL-TOTAL", index: 2 },
      { name: "NUMBER-OF-GROUPS", index: 3 },
      { name: "NUMBER-OF-RECORDS", index: 4, note: "records in the file, 01..99" }
    ]
  };
  function splitRecordFields(line) {
    const fields = [];
    let start = 0;
    for (let i = 0; i <= line.length; i += 1) {
      if (i === line.length || line[i] === ",") {
        const text = line.slice(start, i);
        fields.push({ text, start: start + 1, length: text.length });
        start = i + 1;
      }
    }
    const last = fields[fields.length - 1];
    if (last && last.text.endsWith("/")) {
      last.text = last.text.slice(0, -1);
      last.length -= 1;
    }
    return fields;
  }
  function recordCodeOf(line) {
    return line.slice(0, 2);
  }
  function toFieldMap(code, fields, line) {
    const layout = BAI2_LAYOUTS[code];
    const values = {};
    const spans = {};
    if (!layout) {
      values["RAW"] = line;
      spans["RAW"] = { start: 1, length: line.length };
      return { values, spans };
    }
    for (const spec of layout) {
      if (code === "16" && spec.name === "TEXT") {
        const first = fields[spec.index - 1];
        if (!first) continue;
        const text = line.slice(first.start - 1);
        values[spec.name] = text.endsWith("/") ? text.slice(0, -1) : text;
        spans[spec.name] = { start: first.start, length: values[spec.name].length };
        continue;
      }
      const field = fields[spec.index - 1];
      values[spec.name] = field ? field.text : "";
      if (field) spans[spec.name] = { start: field.start, length: field.length };
    }
    if (code !== "16" && fields.length > layout.length) {
      const extraStart = fields[layout.length];
      values["EXTRA"] = fields.slice(layout.length).map((f) => f.text).join(",");
      spans["EXTRA"] = { start: extraStart.start, length: line.length - extraStart.start + 1 };
    }
    return { values, spans };
  }
  function summaryTriples(fields, from) {
    const triples = [];
    let pendingTypeCode;
    for (let i = from; i < fields.length; i += 1) {
      const text = fields[i].text.trim();
      if (!/^\d{3}$/.test(text)) continue;
      const next = fields[i + 1] ? fields[i + 1].text.trim() : "";
      if (/^[+-]?\d+$/.test(next)) {
        triples.push({ typeCode: text, amount: next });
        i += 1;
        continue;
      }
      if (next === "") pendingTypeCode = text;
    }
    return pendingTypeCode ? { triples, pendingTypeCode } : { triples };
  }
  function directionOfTypeCode(typeCode) {
    if (!/^\d{3}$/.test(typeCode)) return "unknown";
    const code = Number(typeCode);
    if (code >= 100 && code <= 399) return "credit";
    if (code >= 400 && code <= 699) return "debit";
    return "unknown";
  }
  function decodeBai2Amount(raw, scale) {
    let text = raw.trim();
    let negative = false;
    if (text.endsWith("}")) {
      negative = true;
      text = text.slice(0, -1);
    } else if (text.endsWith("{")) {
      text = text.slice(0, -1);
    }
    if (text.startsWith("-")) {
      negative = true;
      text = text.slice(1);
    } else if (text.startsWith("+")) {
      text = text.slice(1);
    }
    if (!/^\d+$/.test(text)) throw new Error(`not a BAI2 amount: ${JSON.stringify(raw)}`);
    const magnitude = BigInt(text);
    return { minorUnits: negative && magnitude !== 0n ? -magnitude : magnitude, negative };
  }
  function isoFromBai2Date(raw, century = 2e3) {
    if (!/^\d{6}$/.test(raw)) return null;
    const year = century + Number(raw.slice(0, 2));
    const month = Number(raw.slice(2, 4));
    const day = Number(raw.slice(4, 6));
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // src/bai2/reader.ts
  function bai2Spec(notes = []) {
    return {
      name: "BAI2-FILE",
      format: "bai2",
      recordLength: 0,
      fields: [],
      semantics: {
        amount: "AMOUNT",
        currency: "CURRENCY",
        valueDate: "AS-OF-DATE",
        dateFormat: "YYMMDD",
        reference: "CUSTOMER-REFERENCE",
        transactionType: "TYPE-CODE"
      },
      framing: "line",
      notes: [
        "BAI2 is comma-delimited: recordLength is 0 by definition and field offsets are per record (see TypedRecord.spans).",
        ...notes
      ],
      source: [
        "# BAI2 (cash management balance reporting) - declared record layouts",
        ...Object.entries(BAI2_LAYOUTS).map(([code, fields]) => `${code}: ${fields.map((f) => f.name).join(", ")}`)
      ].join("\n")
    };
  }
  function parseBai2(source, options = {}) {
    const buffer = isBytes(source) ? source : fromLatin1(source);
    const text = toLatin1(buffer);
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const trailingNewline = text.length > 0 && text.endsWith(eol);
    const lines = text.length === 0 ? [] : text.split(eol);
    if (trailingNewline) lines.pop();
    const exponents = { ...CURRENCY_EXPONENTS, ...options.currencyExponents ?? {} };
    const century = options.century ?? 2e3;
    const issues = [];
    const records = [];
    const totalsByCurrency = {};
    const creditTotalsByCurrency = {};
    const debitTotalsByCurrency = {};
    let group = null;
    let account = null;
    let currentCurrency = "";
    let groupCount = 0;
    let seenFileHeader = false;
    let seenFileTrailer = false;
    let fileTrailerIssues = [];
    const declaredCredits = /* @__PURE__ */ new Map();
    let lastAmountRecord = null;
    const addSummary = (state2, triples, scale, recordIndex) => {
      for (const triple of triples) {
        let minorUnits;
        try {
          minorUnits = decodeBai2Amount(triple.amount, scale).minorUnits;
        } catch (error) {
          issues.push({
            code: "FIELD_INVALID_NUMERIC",
            recordIndex,
            field: "AMOUNT",
            detail: `${triple.typeCode} summary amount is not a BAI2 amount: ${error.message}`
          });
          continue;
        }
        const magnitude = minorUnits < 0n ? -minorUnits : minorUnits;
        state2.summaryMinorUnits += magnitude;
        if (triple.typeCode === "100") {
          const bucket = declaredCredits.get(state2.currency);
          if (bucket) bucket.minorUnits += magnitude;
          else declaredCredits.set(state2.currency, { minorUnits: magnitude, scale, recordIndex });
        }
      }
    };
    lines.forEach((line, index) => {
      const recordIssues = [];
      const pushIssue = (code2, detail, extra = {}) => {
        const issue = { code: code2, recordIndex: index, detail, ...extra };
        recordIssues.push(issue);
        issues.push(issue);
      };
      const code = recordCodeOf(line);
      const splitFields = splitRecordFields(line);
      const { values: rawFields, spans } = toFieldMap(code, splitFields, line);
      const values = {};
      const slices = {};
      for (const [name, fieldText] of Object.entries(rawFields)) {
        slices[name] = fieldText;
        values[name] = fieldText;
      }
      values["REC-CODE"] = code;
      let isTrailer = true;
      switch (code) {
        case "01": {
          if (index !== 0) pushIssue("BAI2_STRUCTURE", "the file header (01) is not the first record");
          seenFileHeader = true;
          if (rawFields["VERSION"] && rawFields["VERSION"] !== "2") {
            pushIssue("BAI2_STRUCTURE", `file header declares version ${rawFields["VERSION"]}, not BAI2 (2)`);
          }
          break;
        }
        case "02": {
          if (!seenFileHeader) pushIssue("BAI2_STRUCTURE", "a group header (02) appears before the file header (01)");
          if (group) pushIssue("BAI2_STRUCTURE", "a group header (02) opened while the previous group had no trailer (98)");
          groupCount += 1;
          const currency = (rawFields["CURRENCY"] ?? "").trim();
          const asOfRaw = (rawFields["AS-OF-DATE"] ?? "").trim();
          const iso = isoFromBai2Date(asOfRaw, century);
          if (!iso) pushIssue("BAI2_RECORD_INVALID", `group header as-of date ${JSON.stringify(asOfRaw)} is not YYMMDD`);
          else values["AS-OF-DATE__iso"] = iso;
          group = { asOfDate: iso, currency, startIndex: index, accountControlTotals: [] };
          currentCurrency = currency;
          break;
        }
        case "03": {
          if (!group) pushIssue("BAI2_STRUCTURE", "an account record (03) appears outside a group");
          if (account) pushIssue("BAI2_STRUCTURE", "an account record (03) opened while the previous account had no trailer (49)");
          const currency = (rawFields["CURRENCY"] ?? "").trim() || (group?.currency ?? "");
          currentCurrency = currency;
          const scale = exponents[currency] ?? 2;
          if (currency !== "" && exponents[currency] === void 0) {
            pushIssue("CURRENCY_SCALE_MISMATCH", `${currency} is not in the ISO-4217 table; a ${scale}-digit scale was assumed for the 03 amount`);
          }
          let minorUnits;
          try {
            minorUnits = decodeBai2Amount(rawFields["AMOUNT"] ?? "", scale).minorUnits;
            values["AMOUNT"] = { minorUnits, currency, scale };
          } catch (error) {
            pushIssue("FIELD_INVALID_NUMERIC", `03 amount is not a BAI2 amount: ${error.message}`, { field: "AMOUNT" });
          }
          const summaryScan = summaryTriples(splitFields, 3);
          account = {
            account: (rawFields["ACCOUNT"] ?? "").trim(),
            currency,
            startIndex: index,
            summaryMinorUnits: 0n,
            detailMinorUnits: 0n,
            pendingTypeCode: summaryScan.pendingTypeCode ?? null
          };
          addSummary(account, summaryScan.triples, scale, index);
          lastAmountRecord = "03";
          break;
        }
        case "16": {
          isTrailer = false;
          lastAmountRecord = "16";
          if (!account) pushIssue("BAI2_STRUCTURE", "a detail record (16) appears outside an account block");
          const typeCode = (rawFields["TYPE-CODE"] ?? "").trim();
          const currency = account?.currency || currentCurrency;
          const scale = exponents[currency] ?? 2;
          const direction = directionOfTypeCode(typeCode);
          if (direction === "unknown") {
            pushIssue(
              "BAI2_RECORD_INVALID",
              `type code ${JSON.stringify(typeCode)} is outside the BAI2 credit (100-399) and debit (400-699) ranges; the amount was taken as positive`,
              { field: "TYPE-CODE", actual: typeCode }
            );
          }
          try {
            const { minorUnits, negative } = decodeBai2Amount(rawFields["AMOUNT"] ?? "", scale);
            const signed = negative || direction === "debit" ? -minorUnits : minorUnits;
            const amount = { minorUnits: signed, currency, scale };
            values["AMOUNT"] = amount;
            if (account) {
              account.detailMinorUnits += signed < 0n ? -signed : signed;
            }
            const bucket = totalsByCurrency[currency] ?? (totalsByCurrency[currency] = { minorUnits: 0n, scale, records: 0 });
            bucket.minorUnits += signed;
            bucket.records += 1;
            const grossTarget = signed < 0n ? debitTotalsByCurrency : creditTotalsByCurrency;
            const grossBucket = grossTarget[currency] ?? (grossTarget[currency] = { minorUnits: 0n, scale, records: 0 });
            grossBucket.minorUnits += signed < 0n ? -signed : signed;
            grossBucket.records += 1;
          } catch (error) {
            pushIssue("FIELD_INVALID_NUMERIC", `16 amount is not a BAI2 amount: ${error.message}`, { field: "AMOUNT" });
          }
          const asOf = group?.asOfDate ?? null;
          if (asOf) {
            values["AS-OF-DATE"] = BigInt(asOf.replaceAll("-", "").slice(2));
            values["AS-OF-DATE__iso"] = asOf;
          }
          break;
        }
        case "49": {
          if (!account) {
            pushIssue("BAI2_STRUCTURE", "an account trailer (49) appears with no open account block");
            break;
          }
          const accountRecords = index - account.startIndex + 1;
          const declaredCountRaw = (rawFields["NUMBER-OF-RECORDS"] ?? "").trim();
          if (declaredCountRaw !== "" && /^\d+$/.test(declaredCountRaw) && BigInt(declaredCountRaw) !== BigInt(accountRecords)) {
            pushIssue(
              "BAI2_CONTROL_MISMATCH",
              `account ${account.account} trailer declares ${declaredCountRaw} records but ${accountRecords} were read in the account block (03..49)`,
              { field: "NUMBER-OF-RECORDS", declared: Number(declaredCountRaw), actual: accountRecords }
            );
          }
          const scale = exponents[account.currency] ?? 2;
          const declaredTotalRaw = (rawFields["ACCOUNT-CONTROL-TOTAL"] ?? "").trim();
          if (declaredTotalRaw !== "") {
            try {
              const { minorUnits } = decodeBai2Amount(declaredTotalRaw, scale);
              const computed = account.summaryMinorUnits + account.detailMinorUnits;
              group?.accountControlTotals.push(minorUnits);
              if (minorUnits !== computed) {
                pushIssue(
                  "BAI2_CONTROL_MISMATCH",
                  `account ${account.account} control total declares ${minorUnits} minor units but the 03 summaries, 16 details and 88 continuations sum to ${computed}`,
                  { field: "ACCOUNT-CONTROL-TOTAL", declared: minorUnits.toString(), actual: computed.toString() }
                );
              }
            } catch (error) {
              pushIssue("BAI2_RECORD_INVALID", `account trailer control total is not an amount: ${error.message}`);
            }
          }
          account = null;
          lastAmountRecord = null;
          break;
        }
        case "88": {
          if (!seenFileHeader) pushIssue("BAI2_STRUCTURE", "a continuation record (88) appears before the file header");
          if (account && lastAmountRecord === "03") {
            const scan = summaryTriples(splitFields, 1);
            const triples = [...scan.triples];
            if (account.pendingTypeCode) {
              const first = (splitFields[1]?.text ?? "").trim();
              if (/^[+-]?\d+$/.test(first)) {
                triples.unshift({ typeCode: account.pendingTypeCode, amount: first });
                account.pendingTypeCode = null;
              }
            }
            addSummary(account, triples, exponents[account.currency] ?? 2, index);
            account.pendingTypeCode = scan.pendingTypeCode ?? account.pendingTypeCode;
          }
          break;
        }
        case "98": {
          if (!group) {
            pushIssue("BAI2_STRUCTURE", "a group trailer (98) appears with no open group");
            break;
          }
          const groupRecords = index - group.startIndex + 1;
          const declaredCountRaw = (rawFields["NUMBER-OF-RECORDS"] ?? "").trim();
          if (declaredCountRaw !== "" && /^\d+$/.test(declaredCountRaw) && BigInt(declaredCountRaw) !== BigInt(groupRecords)) {
            pushIssue(
              "BAI2_CONTROL_MISMATCH",
              `group trailer declares ${declaredCountRaw} records but ${groupRecords} were read in the group (02..98)`,
              { field: "NUMBER-OF-RECORDS", declared: Number(declaredCountRaw), actual: groupRecords }
            );
          }
          const declaredAccounts = (rawFields["NUMBER-OF-ACCOUNTS"] ?? "").trim();
          const accountCount = records.filter((r, i) => i >= group.startIndex && i < index && r.values["REC-CODE"] === "03").length;
          if (declaredAccounts !== "" && /^\d+$/.test(declaredAccounts) && Number(declaredAccounts) !== accountCount) {
            pushIssue(
              "BAI2_CONTROL_MISMATCH",
              `group trailer declares ${declaredAccounts} accounts but ${accountCount} account records (03) were read`,
              { field: "NUMBER-OF-ACCOUNTS", declared: Number(declaredAccounts), actual: accountCount }
            );
          }
          const scale = exponents[group.currency] ?? 2;
          const declaredTotalRaw = (rawFields["GROUP-CONTROL-TOTAL"] ?? "").trim();
          if (declaredTotalRaw !== "") {
            try {
              const { minorUnits } = decodeBai2Amount(declaredTotalRaw, scale);
              const summed = group.accountControlTotals.reduce((acc, v) => acc + v, 0n);
              if (minorUnits !== summed) {
                pushIssue(
                  "BAI2_CONTROL_MISMATCH",
                  `group control total declares ${minorUnits} minor units but the account control totals sum to ${summed}`,
                  { field: "GROUP-CONTROL-TOTAL", declared: minorUnits.toString(), actual: summed.toString() }
                );
              }
            } catch (error) {
              pushIssue("BAI2_RECORD_INVALID", `group trailer control total is not an amount: ${error.message}`);
            }
          }
          group = null;
          account = null;
          currentCurrency = "";
          break;
        }
        case "99": {
          seenFileTrailer = true;
          if (group) pushIssue("BAI2_STRUCTURE", "the file trailer (99) closed a file with an open group");
          if (account) pushIssue("BAI2_STRUCTURE", "the file trailer (99) closed a file with an open account");
          const declaredGroups = (rawFields["NUMBER-OF-GROUPS"] ?? "").trim();
          if (declaredGroups !== "" && /^\d+$/.test(declaredGroups) && Number(declaredGroups) !== groupCount) {
            pushIssue(
              "BAI2_CONTROL_MISMATCH",
              `file trailer declares ${declaredGroups} groups but ${groupCount} group headers were read`,
              { field: "NUMBER-OF-GROUPS", declared: Number(declaredGroups), actual: groupCount }
            );
          }
          const declaredRecords = (rawFields["NUMBER-OF-RECORDS"] ?? "").trim();
          if (declaredRecords !== "" && /^\d+$/.test(declaredRecords) && Number(declaredRecords) !== lines.length) {
            pushIssue(
              "BAI2_CONTROL_MISMATCH",
              `file trailer declares ${declaredRecords} records but the file holds ${lines.length}`,
              { field: "NUMBER-OF-RECORDS", declared: Number(declaredRecords), actual: lines.length }
            );
          }
          break;
        }
        default:
          pushIssue("BAI2_STRUCTURE", `unknown record code ${JSON.stringify(code)} on line ${index + 1}`);
          break;
      }
      records.push({
        index,
        raw: line,
        length: line.length,
        values,
        slices,
        spans,
        issues: recordIssues,
        isTrailer
      });
    });
    fileTrailerIssues = [];
    if (!seenFileHeader) fileTrailerIssues.push({ code: "BAI2_STRUCTURE", recordIndex: 0, detail: "the file has no header record (01)" });
    if (!seenFileTrailer) {
      fileTrailerIssues.push({ code: "BAI2_STRUCTURE", recordIndex: records.length - 1, detail: "the file has no trailer record (99)" });
    }
    if (group) fileTrailerIssues.push({ code: "BAI2_STRUCTURE", recordIndex: records.length - 1, detail: "the file ended inside a group (no 98 trailer)" });
    if (account) fileTrailerIssues.push({ code: "BAI2_STRUCTURE", recordIndex: records.length - 1, detail: "the file ended inside an account block (no 49 trailer)" });
    issues.push(...fileTrailerIssues);
    let declaredControl;
    if (declaredCredits.size === 1) {
      const [currency, bucket] = [...declaredCredits.entries()][0];
      declaredControl = { recordIndex: bucket.recordIndex, total: { minorUnits: bucket.minorUnits, currency, scale: bucket.scale } };
    } else if (declaredCredits.size > 1) {
      issues.push({
        code: "SPEC_MISSING",
        detail: `03 records declare total credits in ${declaredCredits.size} currencies (${[...declaredCredits.keys()].join(", ")}); no single declared credit total can be compared, so control totals are left to the per-account checks`
      });
    } else {
      issues.push({
        code: "SPEC_MISSING",
        detail: "no 03 account summary declares BAI2 type code 100 (total credits), so there is no declared credit total to compare against"
      });
    }
    const detailCount = records.filter((r) => !r.isTrailer).length;
    const copybook = bai2Spec([
      declaredControl ? "declared control: 03 account summary code 100 (total credits), the only BAI2 number comparable to a payment total" : "declared control: none (no single 03 code 100 total)",
      "the 98 group control total covers account control totals (which include 03 summary amounts), so it is checked at the BAI2 level and not used as a payment total",
      "dates: BAI2 carries YYMMDD without a century; this reader applies 2000 (documented in docs/bai2.md \xA73)"
    ]);
    const copybookHash = sha256(copybook.source);
    const fileHash = sha256(buffer);
    const fingerprint = sha256(
      [
        `bai2:${copybookHash}`,
        `file:${fileHash}`,
        `records:${records.map((r) => sha256(r.raw)).join(",")}`,
        `issues:${issues.map((i) => `${i.code}@${i.recordIndex ?? "-"}:${i.field ?? "-"}`).join(",")}`,
        declaredControl?.total ? `declared:${declaredControl.total.minorUnits.toString()}${declaredControl.total.currency}` : "declared:-"
      ].join("|")
    );
    return {
      copybook,
      framing: "line",
      records,
      issues,
      ...declaredControl ? { declaredControl } : {},
      computedControl: { recordCount: records.length, detailCount, totalsByCurrency, creditTotalsByCurrency, debitTotalsByCurrency },
      eol: lines.length === 0 ? null : eol,
      trailingNewline,
      fileHash,
      copybookHash,
      fingerprint,
      source: buffer
    };
  }

  // src/reconcile/reconciler.ts
  var NON_BLOCKING_PARSE_ISSUES = /* @__PURE__ */ new Set(["SPEC_MISSING"]);
  function isBlockingIssue(issue) {
    return !NON_BLOCKING_PARSE_ISSUES.has(issue.code);
  }
  function blockingIssuesOf(result) {
    return result.issues.filter(isBlockingIssue);
  }
  function amountOf(record, copybook) {
    const amountField = copybook.semantics.amount;
    if (!amountField) return void 0;
    const value = record.values[amountField];
    return value && typeof value === "object" ? value : void 0;
  }
  function isoDateOf(record, copybook) {
    const field = copybook.semantics.valueDate;
    if (!field) return void 0;
    const iso = record.values[`${field}__iso`];
    return typeof iso === "string" ? iso : void 0;
  }
  function dayDiff(a, b) {
    const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
    return Math.round(ms / 864e5);
  }
  function withinWindow(date, window2, toleranceDays) {
    return dayDiff(date, window2.start) >= -toleranceDays && dayDiff(window2.end, date) >= -toleranceDays;
  }
  function resolveDeclaredBucket(declared, buckets) {
    const keys = Object.keys(buckets);
    if (declared.currency) {
      return buckets[declared.currency] ? { currency: declared.currency } : { missing: "declared-absent" };
    }
    if (keys.length === 0) return { missing: "no-amounts" };
    if (keys.length === 1) return { currency: keys[0] };
    return { missing: "undeclared-multi" };
  }
  function missingCurrencyDetail(label, declared, buckets, reason) {
    const keys = Object.keys(buckets).sort();
    const declaredText = declared.currency ? formatAmount(declared) : `${formatAmount({ ...declared, currency: "" })} with no currency`;
    if (reason === "declared-absent") {
      return `${label} control total declares ${declaredText} but no detail record is denominated in ${declared.currency} (detail currencies: ${keys.join(", ")}); the total is not compared against another currency`;
    }
    if (reason === "undeclared-multi") {
      return `${label} control total declares ${declaredText} and the detail records carry more than one currency (${keys.join(", ")}); which bucket it controls cannot be read from the file, so it is not compared`;
    }
    return `${label} control total declares ${declaredText} but no detail record carries an amount, so there is nothing to compare`;
  }
  function controlFindings(result, label) {
    const findings = [];
    const { copybook, declaredControl, computedControl } = result;
    if (declaredControl?.count !== void 0) {
      const declared = declaredControl.count;
      const computed = BigInt(computedControl.detailCount);
      if (declared !== computed) {
        findings.push({
          code: "CONTROL_COUNT_MISMATCH",
          recordIndex: declaredControl.recordIndex,
          field: copybook.control?.countField,
          declared,
          computed,
          // Signed as "what the file actually contains minus what it declares" (see design.md §10.5).
          delta: computed - declared,
          detail: `${label} control count declares ${declared} records but ${computed} detail records were read`
        });
      }
    }
    if (declaredControl?.total) {
      const declared = declaredControl.total;
      const buckets = computedControl.totalsByCurrency;
      const resolution = resolveDeclaredBucket(declared, buckets);
      if (!resolution.currency) {
        findings.push({
          code: "MISSING_CURRENCY",
          recordIndex: declaredControl.recordIndex,
          field: copybook.control?.totalField,
          declared,
          detail: missingCurrencyDetail(label, declared, buckets, resolution.missing)
        });
      } else {
        const bucketKey = resolution.currency;
        const bucket = buckets[bucketKey];
        const computedMinor = bucket?.minorUnits ?? 0n;
        const delta = computedMinor - declared.minorUnits;
        if (delta !== 0n) {
          const credits = computedControl.creditTotalsByCurrency?.[bucketKey];
          const debits = computedControl.debitTotalsByCurrency?.[bucketKey];
          const composition = credits || debits ? ` (credits ${formatAmount({ minorUnits: credits?.minorUnits ?? 0n, currency: declared.currency || bucketKey, scale: declared.scale })} minus debits ${formatAmount({ minorUnits: debits?.minorUnits ?? 0n, currency: declared.currency || bucketKey, scale: declared.scale })})` : "";
          findings.push({
            code: "CONTROL_TOTAL_MISMATCH",
            recordIndex: declaredControl.recordIndex,
            field: copybook.control?.totalField,
            declared,
            computed: { minorUnits: computedMinor, currency: declared.currency || bucketKey, scale: declared.scale },
            delta: { minorUnits: delta, currency: declared.currency || bucketKey, scale: declared.scale },
            detail: `${label} control total declares ${formatAmount(declared)} but the detail records net to ${formatAmount({ ...declared, minorUnits: computedMinor })}${composition} (delta ${formatAmount({ ...declared, minorUnits: delta })})`
          });
        }
      }
    }
    return findings;
  }
  function formatAmount(amount) {
    const negative = amount.minorUnits < 0n;
    const magnitude = negative ? -amount.minorUnits : amount.minorUnits;
    const power = 10n ** BigInt(amount.scale);
    const whole = magnitude / power;
    const fraction = amount.scale > 0 ? `.${(magnitude % power).toString().padStart(amount.scale, "0")}` : "";
    return `${negative ? "-" : ""}${groupDigits(whole.toString())}${fraction}${amount.currency ? ` ${amount.currency}` : ""}`;
  }
  function groupDigits(digits) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function referenceRecords(result) {
    const { copybook } = result;
    if (!copybook.semantics.reference) return [];
    const out = [];
    for (const record of result.records) {
      if (record.isTrailer) continue;
      const value = record.values[copybook.semantics.reference];
      if (typeof value !== "string") continue;
      const amount = amountOf(record, copybook);
      const date = isoDateOf(record, copybook);
      out.push({
        record,
        reference: value.trim(),
        ...amount ? { amount } : {},
        ...date ? { date } : {}
      });
    }
    return out;
  }
  function referenceFindings(payment, bank, toleranceDays) {
    const findings = [];
    const paymentRefs = referenceRecords(payment);
    const bankRefs = referenceRecords(bank);
    const usedBank = /* @__PURE__ */ new Set();
    let matched = 0;
    for (const p of paymentRefs) {
      if (p.reference === "") {
        findings.push({
          code: "REF_UNMATCHED",
          recordIndex: p.record.index,
          field: payment.copybook.semantics.reference,
          reference: "",
          detail: `820 record ${p.record.index} has a blank reference field and cannot be matched (direction: 820-only)`
        });
        continue;
      }
      const exact = bankRefs.find((b) => b.reference === p.reference && b.reference !== "" && !usedBank.has(b.record.index));
      if (exact) {
        usedBank.add(exact.record.index);
        matched += 1;
        continue;
      }
      if (p.amount) {
        const fallback = bankRefs.find(
          (b) => b.reference !== "" && !usedBank.has(b.record.index) && b.amount !== void 0 && b.amount.currency === p.amount.currency && b.amount.minorUnits === p.amount.minorUnits && (p.date === void 0 || b.date === void 0 || Math.abs(dayDiff(p.date, b.date)) <= toleranceDays)
        );
        if (fallback) {
          usedBank.add(fallback.record.index);
          matched += 1;
          continue;
        }
      }
      findings.push({
        code: "REF_UNMATCHED",
        recordIndex: p.record.index,
        field: payment.copybook.semantics.reference,
        reference: p.reference,
        ...p.amount ? { declared: p.amount } : {},
        detail: `820 reference ${p.reference} has no counterpart in the bank file (direction: 820-only)`
      });
    }
    for (const b of bankRefs) {
      if (usedBank.has(b.record.index)) continue;
      findings.push({
        code: "REF_UNMATCHED",
        recordIndex: b.record.index,
        field: bank.copybook.semantics.reference,
        reference: b.reference,
        ...b.amount ? { declared: b.amount } : {},
        detail: b.reference === "" ? `bank record ${b.record.index} has a blank reference field and cannot be matched (direction: bank-only)` : `bank reference ${b.reference} has no counterpart in the 820 file (direction: bank-only)`
      });
    }
    return { findings, matched };
  }
  function dateFindings(result, label, window2, toleranceDays) {
    if (!result.copybook.semantics.valueDate) return [];
    return result.records.filter((r) => !r.isTrailer).map((record) => ({ record, iso: isoDateOf(record, result.copybook) })).filter((x) => x.iso !== void 0).filter((x) => !withinWindow(x.iso, window2, toleranceDays)).map((x) => ({
      code: "DATE_OUT_OF_WINDOW",
      recordIndex: x.record.index,
      field: result.copybook.semantics.valueDate,
      declared: `${window2.start}..${window2.end}`,
      computed: x.iso,
      detail: `${label} record ${x.record.index} has value date ${x.iso}, outside the settlement window ${window2.start}..${window2.end} (tolerance ${toleranceDays}d)`
    }));
  }
  function findingKey(finding) {
    const render3 = (value) => {
      if (value === void 0) return "-";
      if (typeof value === "bigint") return value.toString();
      if (typeof value === "string") return value;
      if (typeof value === "object" && value !== null && "minorUnits" in value) {
        const amount = value;
        return `${amount.minorUnits.toString()}${amount.currency}@${amount.scale}`;
      }
      return "-";
    };
    return [
      finding.code,
      finding.recordIndex,
      finding.field ?? "-",
      finding.reference ?? "-",
      render3(finding.declared),
      render3(finding.computed),
      render3(finding.delta)
    ].join("|");
  }
  function normaliseFinding(finding) {
    return findingKey(finding);
  }
  function sortFindings(findings) {
    return [...findings].sort((a, b) => normaliseFinding(a).localeCompare(normaliseFinding(b)));
  }
  function reconcile(input) {
    const toleranceDays = input.options?.toleranceDays ?? 0;
    const findings = [];
    findings.push(...controlFindings(input.payment, "820"));
    let bankFileHash = null;
    let referencesMatched = 0;
    if (input.bank) {
      findings.push(...controlFindings(input.bank, "bank"));
      bankFileHash = input.bank.fileHash;
      const refResult = referenceFindings(input.payment, input.bank, toleranceDays);
      findings.push(...refResult.findings);
      referencesMatched = refResult.matched;
    }
    if (input.options?.settlementWindow) {
      findings.push(...dateFindings(input.payment, "820", input.options.settlementWindow, toleranceDays));
      if (input.bank) {
        findings.push(...dateFindings(input.bank, "bank", input.options.settlementWindow, toleranceDays));
      }
    }
    const sorted = sortFindings(findings);
    const paymentTotals = input.payment.computedControl.totalsByCurrency;
    const totals = {};
    const declaredTotal = input.payment.declaredControl?.total;
    if (declaredTotal) {
      const resolution = resolveDeclaredBucket(declaredTotal, paymentTotals);
      if (resolution.currency) {
        const currency = resolution.currency;
        const computed = paymentTotals[currency]?.minorUnits ?? 0n;
        const credits = input.payment.computedControl.creditTotalsByCurrency?.[currency];
        const debits = input.payment.computedControl.debitTotalsByCurrency?.[currency];
        totals[currency] = {
          declared: declaredTotal.minorUnits.toString(),
          computed: computed.toString(),
          delta: (computed - declaredTotal.minorUnits).toString(),
          basis: "signed detail total",
          ...credits ? { credits: credits.minorUnits.toString() } : {},
          ...debits ? { debits: debits.minorUnits.toString() } : {}
        };
      } else {
        const label = declaredTotal.currency || "(no currency declared)";
        totals[label] = {
          declared: declaredTotal.minorUnits.toString(),
          computed: "-",
          delta: "-",
          basis: "not compared: the file holds no detail amount in this currency"
        };
      }
    }
    const bankDeclared = input.bank?.declaredControl?.total;
    if (input.bank && bankDeclared) {
      const bankTotalsByCurrency = input.bank.computedControl.totalsByCurrency;
      const resolution = resolveDeclaredBucket(bankDeclared, bankTotalsByCurrency);
      const source = input.bank.copybook.format === "bai2" ? "03/100 credits" : "trailer";
      if (resolution.currency) {
        const currency = resolution.currency;
        const bankTotals = bankTotalsByCurrency[currency];
        const bankCredits = input.bank.computedControl.creditTotalsByCurrency?.[currency];
        const bankDebits = input.bank.computedControl.debitTotalsByCurrency?.[currency];
        totals[`${currency} (bank ${source})`] = {
          declared: bankDeclared.minorUnits.toString(),
          computed: (bankTotals?.minorUnits ?? 0n).toString(),
          delta: ((bankTotals?.minorUnits ?? 0n) - bankDeclared.minorUnits).toString(),
          basis: "credits minus debits (net)",
          ...bankCredits ? { credits: bankCredits.minorUnits.toString() } : {},
          ...bankDebits ? { debits: bankDebits.minorUnits.toString() } : {}
        };
      } else {
        const label = bankDeclared.currency || "(no currency declared)";
        totals[`${label} (bank ${source})`] = {
          declared: bankDeclared.minorUnits.toString(),
          computed: "-",
          delta: "-",
          basis: "not compared: the file holds no bank detail amount in this currency"
        };
      }
    }
    const paymentBlocking = blockingIssuesOf(input.payment);
    const bankBlocking = input.bank ? blockingIssuesOf(input.bank) : [];
    const blocking = [...paymentBlocking, ...bankBlocking];
    const referencesMatchedTotal = referencesMatched;
    const summary = {
      paymentRecords: input.payment.computedControl.recordCount,
      paymentDetails: input.payment.computedControl.detailCount,
      bankRecords: input.bank?.computedControl.recordCount ?? 0,
      bankDetails: input.bank?.computedControl.detailCount ?? 0,
      referencesMatched: referencesMatchedTotal,
      referencesUnmatched: sorted.filter((f) => f.code === "REF_UNMATCHED").length,
      totals,
      blockingParseIssues: blocking.length,
      parseIssues: { payment: input.payment.issues.length, bank: input.bank?.issues.length ?? 0 }
    };
    const status = sorted.length > 0 ? "FAIL" : blocking.length > 0 ? "INCOMPLETE" : "PASS";
    const fingerprint = sha256(
      [
        `payment:${input.payment.fileHash}`,
        `bank:${bankFileHash ?? "-"}`,
        `copybook:${input.payment.copybookHash}`,
        `bankCopybook:${input.bank?.copybookHash ?? "-"}`,
        `window:${input.options?.settlementWindow ? `${input.options.settlementWindow.start}..${input.options.settlementWindow.end}` : "-"}`,
        `tolerance:${toleranceDays}`,
        `status:${status}`,
        `blocking:${blocking.map((issue) => `${issue.code}@${issue.recordIndex ?? "-"}:${issue.field ?? "-"}`).join(",")}`,
        `findings:${sorted.map(normaliseFinding).join(";")}`
      ].join("|")
    );
    return {
      status,
      findings: sorted,
      summary,
      fingerprint,
      paymentFileHash: input.payment.fileHash,
      bankFileHash
    };
  }

  // src/explain/grounded.ts
  function render(value) {
    if (value === void 0) return "(not declared)";
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "string") return value;
    return formatAmount(value);
  }
  function createGroundedAdapter() {
    return {
      name: "grounded",
      live: false,
      async explain({ finding }) {
        switch (finding.code) {
          case "CONTROL_TOTAL_MISMATCH":
            return {
              cause: `The trailer declares ${render(finding.declared)} but the detail records sum to ${render(finding.computed)}; the difference is ${render(finding.delta)}.`,
              suggestedFix: "Find the record whose amount does not belong to the declared total (record-level amounts are in the evidence panel), correct the trailer or that record, then re-run verify."
            };
          case "CONTROL_COUNT_MISMATCH":
            return {
              cause: `The trailer declares ${render(finding.declared)} detail records but ${render(finding.computed)} were read.`,
              suggestedFix: "Locate the missing or extra detail record, correct the file or the trailer, and re-run verify."
            };
          case "MISSING_CURRENCY":
            return {
              cause: `${finding.detail}`,
              suggestedFix: "Check the currency field of the declared total and of the detail records; either the declaration or the detail amounts are in the wrong currency. Do not resolve this by borrowing another currency bucket."
            };
          case "REF_UNMATCHED":
            return finding.reference === void 0 || finding.reference === "" ? {
              cause: `Record ${finding.recordIndex} has a blank reference field, so it cannot be matched to any counterpart.`,
              suggestedFix: "Fill the reference on this record from the payment instruction, re-run reconcile, and confirm the reference now matches."
            } : {
              cause: `Reference ${finding.reference} on record ${finding.recordIndex} has no counterpart on the other side.`,
              suggestedFix: "Check whether this reference exists on the bank side under a different value, correct the reference on the side that is wrong, and re-run reconcile."
            };
          case "DATE_OUT_OF_WINDOW":
            return {
              cause: `Value date ${render(finding.computed)} on record ${finding.recordIndex} is outside the settlement window ${render(finding.declared)}.`,
              suggestedFix: "Confirm the value date with the settlement instruction; if the window is wrong for this run, pass the correct window to reconcile rather than editing the file."
            };
          case "FIELD_DECLARED_LENGTH_EXCEEDED":
            return {
              cause: `Field ${finding.field ?? "(unnamed)"} on record ${finding.recordIndex} carries more bytes than the copybook declares.`,
              suggestedFix: "Re-encode the record from the copybook, or correct the picture in the copybook if the file is right."
            };
          default:
            return {
              cause: `${finding.code} on record ${finding.recordIndex}: ${finding.detail}`,
              suggestedFix: "Review the finding in the evidence panel and correct the file or the spec."
            };
        }
      }
    };
  }

  // src/explain/evidence.ts
  var NUMERIC_LITERAL_RE = /[+\-\u2212]?\d[\d,]*(?:\.\d+)?/g;
  var ISO_DATE_RE = /\d{4}-\d{2}-\d{2}/g;
  var DIGIT_RUN_RE = /\d+/g;
  function scanNumericLiterals(text) {
    const literals = [];
    const withoutDates = text.replace(ISO_DATE_RE, (match) => {
      for (const part of match.split("-")) literals.push(part);
      return " ".repeat(match.length);
    });
    for (const token of withoutDates.match(NUMERIC_LITERAL_RE) ?? []) {
      literals.push(token);
    }
    return literals;
  }
  function normaliseNumericLiteral(raw) {
    const unified = raw.replace(/[\u2212\u2013\u2014]/g, "-").replace(/,/g, "").replace(/^\+/, "");
    if (unified.startsWith("-") && unified.length > 1) {
      return `-${stripLeadingZeros(unified.slice(1))}`;
    }
    return stripLeadingZeros(unified);
  }
  function identifierToken(raw) {
    const digits = raw.replace(/[+\-\u2212\u2013\u2014]/g, "").replace(/,/g, "");
    return digits;
  }
  function looksLikeIdentifier(raw) {
    const digits = identifierToken(raw);
    return digits.length > 1 && digits.startsWith("0");
  }
  function stripLeadingZeros(digits) {
    const dot = digits.indexOf(".");
    const whole = dot < 0 ? digits : digits.slice(0, dot);
    const rest = dot < 0 ? "" : digits.slice(dot);
    const strippedWhole = whole.replace(/^0+(?=\d)/, "");
    return `${strippedWhole === "" ? "0" : strippedWhole}${rest}`;
  }
  function addLiteral(set, raw) {
    const normalised = normaliseNumericLiteral(raw);
    set.add(normalised);
    const magnitude = normalised.startsWith("-") ? normalised.slice(1) : normalised;
    set.add(magnitude);
    if (normalised.startsWith("-")) set.add(`-${magnitude}`);
    const dot = magnitude.indexOf(".");
    if (dot > 0) set.add(magnitude.slice(0, dot));
  }
  function addScanned(set, text) {
    for (const literal of scanNumericLiterals(text)) {
      if (looksLikeIdentifier(literal)) set.add(identifierToken(literal));
      else addLiteral(set, literal);
    }
  }
  function addIdentifierTokens(set, text) {
    for (const token of text.match(DIGIT_RUN_RE) ?? []) set.add(token);
  }
  function amountForms(amount) {
    const signed = { minorUnits: amount.minorUnits, currency: amount.currency, scale: amount.scale };
    const magnitude = {
      minorUnits: amount.minorUnits < 0n ? -amount.minorUnits : amount.minorUnits,
      currency: amount.currency,
      scale: amount.scale
    };
    const forms = [];
    for (const value of [signed, magnitude]) {
      const withCurrency = formatAmount(value);
      const withoutCurrency = formatAmount({ ...value, currency: "" });
      forms.push(
        withCurrency,
        withoutCurrency,
        withoutCurrency.replace(/,/g, ""),
        value.minorUnits.toString()
      );
    }
    return forms;
  }
  function addValue(set, value) {
    if (value === void 0) return;
    if (typeof value === "bigint") {
      addLiteral(set, value.toString());
      addLiteral(set, (value < 0n ? -value : value).toString());
      return;
    }
    if (typeof value === "string") {
      addScanned(set, value);
      return;
    }
    for (const form of amountForms(value)) addScanned(set, form);
  }
  function findingHasEvidence(finding) {
    return finding.declared !== void 0 || finding.computed !== void 0 || finding.delta !== void 0 || finding.reference !== void 0 && finding.reference !== "";
  }
  function evidenceVocabulary(finding) {
    const set = /* @__PURE__ */ new Set();
    addValue(set, finding.declared);
    addValue(set, finding.computed);
    addValue(set, finding.delta);
    addLiteral(set, String(finding.recordIndex));
    if (finding.reference !== void 0) addIdentifierTokens(set, finding.reference);
    addScanned(set, finding.detail);
    return [...set].sort();
  }
  function validateExplanation(text, finding) {
    const allowed = new Set(evidenceVocabulary(finding));
    const cited = [];
    const unsupported = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of scanNumericLiterals(text)) {
      const canonical = normaliseNumericLiteral(raw);
      const identifier = identifierToken(raw);
      const key = `${canonical}|${identifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (allowed.has(canonical) || allowed.has(identifier)) cited.push(canonical);
      else unsupported.push(canonical);
    }
    return {
      ok: unsupported.length === 0,
      cited,
      unsupported,
      vocabulary: [...allowed].sort().slice(0, 400)
    };
  }
  function citationOf(finding) {
    const field = finding.field ? ` field=${finding.field}` : "";
    const reference = finding.reference ? ` ref=${finding.reference}` : "";
    return `${finding.code} record=${finding.recordIndex}${field}${reference}`;
  }

  // src/explain/prompt.ts
  var STEERING_HINT = {
    CONTROL_TOTAL_MISMATCH: "Control totals in 820/823/BAI2 declare counts and sums. Compare count and sum separately; a matching sum with a wrong count is still a failure. Amounts are minor-unit-scaled by the copybook.",
    CONTROL_COUNT_MISMATCH: "A trailer declares how many detail records it controls. A missing or extra detail record is a count mismatch even when the money still sums correctly.",
    MISSING_CURRENCY: "A control total belongs to one currency bucket. If the declared currency has no detail amount, or a single total is declared against several currencies, which bucket it controls cannot be read from the file: report it and withhold the verdict instead of comparing against another bucket.",
    REF_UNMATCHED: "820 references (TRN/RMR) must be echoed by the bank side (823 RMR/REF, BAI2 customer reference). Matching is exact reference first, then amount+currency+value-date window; anything else is reported, never dropped.",
    DATE_OUT_OF_WINDOW: "Value dates come from the copybook-qualified date field, never guessed. The settlement window is declared for the run, with an explicit day tolerance (default 0).",
    FIELD_DECLARED_LENGTH_EXCEEDED: "A fixed-width field cannot hold more bytes than its picture declares. This code is reserved for records built by hand rather than read from a file."
  };
  function serialiseFinding(finding) {
    const render3 = (value) => {
      if (value === void 0) return void 0;
      if (typeof value === "bigint") return value.toString();
      if (typeof value === "string") return value;
      return {
        formatted: formatAmount(value),
        minorUnits: value.minorUnits.toString(),
        currency: value.currency,
        scale: value.scale
      };
    };
    return {
      code: finding.code,
      recordIndex: finding.recordIndex,
      field: finding.field,
      declared: render3(finding.declared),
      computed: render3(finding.computed),
      delta: render3(finding.delta),
      reference: finding.reference,
      detail: finding.detail
    };
  }
  function buildPrompt(finding) {
    return [
      "You explain one reconciliation finding for a fixed-width payment file (EDI 820/823, BAI2, COBOL copybook).",
      "Rules:",
      "- Use only the numbers in FINDING below. Do not introduce any other number, total, count or date.",
      "- Do not decide whether the file is acceptable; a human does that.",
      '- Answer in two short sentences at most: "cause" (what is wrong, in the file terms) and "suggestedFix" (the next action).',
      '- Reply with JSON only: {"cause": "...", "suggestedFix": "..."}',
      "",
      `DOMAIN RULE: ${STEERING_HINT[finding.code]}`,
      "",
      `FINDING: ${JSON.stringify(serialiseFinding(finding))}`
    ].join("\n");
  }

  // src/explain/explainer.ts
  var INSUFFICIENT_CAUSE = "INSUFFICIENT_EVIDENCE";
  var NO_VALUES_FIX = "The deterministic layers produced no value for this finding, so there is nothing to explain. Supply the missing value or fix the spec, then re-run.";
  var REJECTED_FIX = "A drafted explanation cited values that are not in the finding, so it was withheld. Read the evidence panel for the values the deterministic layers did produce.";
  function insufficientExplanation(finding, options) {
    return {
      code: finding.code,
      recordIndex: finding.recordIndex,
      ...finding.field ? { field: finding.field } : {},
      status: "INSUFFICIENT_EVIDENCE",
      cause: INSUFFICIENT_CAUSE,
      suggestedFix: options.noEvidenceValues ? NO_VALUES_FIX : REJECTED_FIX,
      citation: citationOf(finding),
      adapter: options.adapter,
      citedValues: [],
      ...options.rejection ? { rejection: options.rejection } : {},
      ...options.noEvidenceValues ? { noEvidenceValues: true } : {}
    };
  }
  function resolveAdapters(options) {
    return {
      primary: options.adapter ?? createGroundedAdapter(),
      fallback: options.fallback ?? createGroundedAdapter()
    };
  }
  async function draftWithBudget(finding, options, state2) {
    const { primary, fallback } = resolveAdapters(options);
    const maxLive = options.maxLiveCalls ?? 0;
    const prompt = buildPrompt(finding);
    if (!primary.live) {
      return { draft: await primary.explain({ finding, prompt }), adapter: primary.name };
    }
    if (state2.liveCalls >= maxLive) {
      return {
        draft: await fallback.explain({ finding, prompt }),
        adapter: fallback.name,
        note: `${primary.name} skipped: live-call budget ${maxLive} exhausted`
      };
    }
    state2.liveCalls += 1;
    try {
      return { draft: await primary.explain({ finding, prompt }), adapter: primary.name };
    } catch (error) {
      return {
        draft: await fallback.explain({ finding, prompt }),
        adapter: fallback.name,
        note: `${primary.name} failed (${error.message}); ${fallback.name} used instead`
      };
    }
  }
  async function explainFindings(findings, options = {}) {
    const state2 = { liveCalls: 0 };
    const explanations = [];
    let budgetLimited = 0;
    for (const finding of findings) {
      if (!findingHasEvidence(finding)) {
        explanations.push(insufficientExplanation(finding, { adapter: "none", noEvidenceValues: true }));
        continue;
      }
      const { draft, adapter, note } = await draftWithBudget(finding, options, state2);
      if (note?.includes("budget")) budgetLimited += 1;
      const guard = validateExplanation(`${draft.cause}
${draft.suggestedFix}`, finding);
      const base = {
        code: finding.code,
        recordIndex: finding.recordIndex,
        ...finding.field ? { field: finding.field } : {},
        citation: citationOf(finding),
        ...note ? { note } : {}
      };
      if (!guard.ok) {
        explanations.push({
          ...base,
          status: "INSUFFICIENT_EVIDENCE",
          cause: INSUFFICIENT_CAUSE,
          suggestedFix: REJECTED_FIX,
          adapter,
          citedValues: [],
          rejection: { unsupported: guard.unsupported, draft }
        });
        continue;
      }
      explanations.push({
        ...base,
        status: "EXPLAINED",
        cause: draft.cause,
        suggestedFix: draft.suggestedFix,
        adapter,
        citedValues: guard.cited
      });
    }
    return { explanations, liveCalls: state2.liveCalls, budgetLimited };
  }

  // src/web/view.ts
  function renderValue(value) {
    if (value === void 0 || value === null) return void 0;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "string") return value;
    return formatAmount(value);
  }
  function recordView(record, side, result) {
    const fields = result.copybook.format === "bai2" ? Object.entries(record.spans ?? {}).map(([name, span]) => ({
      name,
      start: span.start,
      length: span.length,
      text: record.raw.slice(span.start - 1, span.start - 1 + span.length),
      pic: "BAI2 field"
    })) : result.copybook.fields.filter(
      (field) => !field.group && record.slices[field.name] !== void 0 && (field.region === void 0 || record.views?.[field.region] === field.layout)
    ).map((field) => ({
      name: field.name,
      start: field.start,
      length: field.length,
      text: record.slices[field.name] ?? "",
      pic: field.pic
    }));
    return {
      index: record.index,
      side,
      isTrailer: record.isTrailer,
      raw: record.raw,
      length: record.length,
      fields,
      issues: record.issues.map((i) => ({ code: i.code, ...i.field ? { field: i.field } : {}, detail: i.detail }))
    };
  }
  function sideFor(finding, payment, bank) {
    if (bank && /^bank\b/i.test(finding.detail)) return "bank";
    const field = finding.field;
    if (field) {
      const inPayment = payment.copybook.fields.some((f) => f.name === field) || payment.copybook.semantics.reference === field;
      if (inPayment) return "payment";
      if (bank && (bank.copybook.fields.some((f) => f.name === field) || bank.copybook.semantics.reference === field)) {
        return "bank";
      }
    }
    if (/^bank\b|direction: bank-only/i.test(finding.detail)) return "bank";
    return "payment";
  }
  function evidenceFor(finding, side, result) {
    const record = result.records[finding.recordIndex];
    if (!record) {
      return { side, recordIndex: finding.recordIndex, raw: "", note: "record not present in this file" };
    }
    const field = finding.field;
    if (!field) {
      return {
        side,
        recordIndex: finding.recordIndex,
        raw: record.raw,
        note: `record ${finding.recordIndex}, ${record.length} characters - the finding is file-wide`
      };
    }
    const spec = result.copybook.fields.find((f) => f.name === field);
    const span = record.spans?.[field] ?? (spec ? { start: spec.start, length: spec.length } : void 0);
    const fieldText = record.slices[field];
    return {
      side,
      recordIndex: finding.recordIndex,
      raw: record.raw,
      field,
      ...spec ? { pic: spec.pic } : {},
      ...span ? { span } : {},
      ...fieldText !== void 0 ? { fieldText } : {},
      note: span ? `${field}${spec ? ` ${spec.pic}` : ""} at bytes ${span.start}-${span.start + span.length - 1} of record ${finding.recordIndex} (1-based)` : `record ${finding.recordIndex}: the field ??${field}?? is not in this file's spec`
    };
  }
  function buildViewModel(input) {
    const { payment, bank, result, files, guarantees } = input;
    const findings = result.findings.map((finding, index) => {
      const side = sideFor(finding, payment, bank);
      const source = side === "bank" && bank ? bank : payment;
      return {
        index,
        code: finding.code,
        recordIndex: finding.recordIndex,
        ...finding.field ? { field: finding.field } : {},
        ...finding.reference ? { reference: finding.reference } : {},
        ...(() => {
          const declared = renderValue(finding.declared);
          const computed = renderValue(finding.computed);
          const delta = renderValue(finding.delta);
          return {
            ...declared !== void 0 ? { declared } : {},
            ...computed !== void 0 ? { computed } : {},
            ...delta !== void 0 ? { delta } : {}
          };
        })(),
        detail: finding.detail,
        evidence: evidenceFor(finding, side, source),
        ...input.explanations?.[index] ? { explanation: input.explanations[index] } : {}
      };
    });
    const records = [
      ...payment.records.map((record) => recordView(record, "payment", payment)),
      ...bank ? bank.records.map((record) => recordView(record, "bank", bank)) : []
    ];
    const issues = [
      ...payment.issues.map((issue) => ({ side: "payment", code: issue.code, ...issue.recordIndex !== void 0 ? { recordIndex: issue.recordIndex } : {}, ...issue.field ? { field: issue.field } : {}, detail: issue.detail })),
      ...(bank?.issues ?? []).map((issue) => ({ side: "bank", code: issue.code, ...issue.recordIndex !== void 0 ? { recordIndex: issue.recordIndex } : {}, ...issue.field ? { field: issue.field } : {}, detail: issue.detail }))
    ];
    const totals = Object.entries(result.summary.totals).map(([currency, value]) => ({
      currency,
      declared: value.declared,
      computed: value.computed,
      delta: value.delta,
      ...value.basis ? { basis: value.basis } : {},
      ...value.credits ? { credits: value.credits } : {},
      ...value.debits ? { debits: value.debits } : {}
    }));
    return {
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      files,
      status: result.status,
      fingerprint: result.fingerprint,
      summary: result.summary,
      totals,
      findings,
      records,
      issues,
      guarantees
    };
  }

  // src/exception/register.ts
  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  function isIsoDate(value) {
    if (!ISO_DATE.test(value)) return false;
    const [year, month, day] = value.split("-").map((part) => Number(part));
    if (year === void 0 || month === void 0 || day === void 0) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  var LedgerError = class extends Error {
    constructor(code, message) {
      super(message);
      __publicField(this, "code", code);
      this.name = "LedgerError";
    }
  };
  function findingKey2(finding) {
    return findingKey(finding);
  }
  function emptyLedger() {
    return { version: 1, entries: [], head: { count: 0, hash: "GENESIS" } };
  }
  function ledgerDigest(ledger) {
    const last = ledger.entries[ledger.entries.length - 1];
    return { count: ledger.entries.length, hash: last ? last.hash : "GENESIS" };
  }
  function parseLedger(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new LedgerError("SHAPE", `Failed to parse ledger: ${error.message}`);
    }
    try {
      if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
      const ledger2 = parsed;
      if (ledger2.version !== 1) throw new Error("version is not 1");
      if (!Array.isArray(ledger2.entries)) throw new Error("entries is not an array");
      ledger2.entries.forEach((entry, index) => {
        if (typeof entry !== "object" || entry === null) throw new Error("entry is not an object");
        const e = entry;
        if (typeof e.seq !== "number" || typeof e.id !== "string" || typeof e.decision !== "string") {
          throw new Error("entry missing required fields");
        }
        if (e.seq !== index + 1) throw new Error(`entry ${index + 1} carries seq ${String(e.seq)}: the sequence must be dense from 1`);
      });
      if (ledger2.head !== void 0) {
        const head = ledger2.head;
        if (typeof head.count !== "number" || typeof head.hash !== "string") throw new Error("head needs count and hash");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new LedgerError("SHAPE", `Failed to parse ledger: ${msg}`);
    }
    const ledger = parsed;
    if (ledger.head) {
      const digest = ledgerDigest(ledger);
      if (ledger.head.count !== digest.count) {
        throw new LedgerError(
          "TRUNCATED",
          `ledger head declares ${ledger.head.count} entries but ${digest.count} were read: trailing entries were removed`
        );
      }
      if (ledger.head.hash !== digest.hash) {
        throw new LedgerError("TRUNCATED", "ledger head hash does not match the last entry: the tail was rewritten or cut");
      }
    }
    return ledger;
  }
  function serialiseLedger(ledger) {
    return JSON.stringify({ version: ledger.version, entries: ledger.entries, head: ledgerDigest(ledger) }, null, 2) + "\n";
  }
  function hashEntry(entry) {
    const canonical = JSON.stringify([
      entry.seq ?? "",
      entry.id ?? "",
      entry.decision ?? "",
      entry.findingKey ?? "",
      entry.code ?? "",
      entry.recordIndex ?? "",
      entry.field ?? "",
      entry.reference ?? "",
      entry.owner ?? "",
      entry.reason ?? "",
      entry.compensatingControl ?? "",
      entry.decidedOn ?? "",
      entry.expiresOn ?? "",
      entry.releaseOf ?? "",
      entry.fingerprint ?? "",
      entry.prevHash ?? ""
    ]);
    return createHash("sha256").update(canonical).digest("hex");
  }
  function verifyLedger(ledger) {
    const digest = ledgerDigest(ledger);
    const result = (ok, detail, firstInvalidSeq = null) => ({
      ok,
      firstInvalidSeq,
      ...detail ? { detail } : {},
      entries: digest.count,
      headHash: digest.hash
    });
    if (ledger.head && (ledger.head.count !== digest.count || ledger.head.hash !== digest.hash)) {
      return result(
        false,
        `ledger head declares ${ledger.head.count} entries with head ${ledger.head.hash}, but the ledger holds ${digest.count} with head ${digest.hash}`,
        ledger.entries.length + 1
      );
    }
    let prevHash = "GENESIS";
    for (const entry of ledger.entries) {
      if (entry.prevHash !== prevHash) {
        return result(false, `prevHash mismatch at seq ${entry.seq}`, entry.seq);
      }
      const computedHash = hashEntry(entry);
      if (entry.hash !== computedHash) {
        return result(false, `hash mismatch at seq ${entry.seq}`, entry.seq);
      }
      prevHash = entry.hash;
    }
    return result(true);
  }
  function appendWaiver(ledger, input, finding, context) {
    if (!input.owner || input.owner.trim().length === 0) {
      throw new LedgerError("INVALID_WAIVER", "owner is required");
    }
    if (!input.reason || input.reason.trim().length === 0) {
      throw new LedgerError("INVALID_WAIVER", "reason is required");
    }
    if (!input.compensatingControl || input.compensatingControl.trim().length === 0) {
      throw new LedgerError("INVALID_WAIVER", "compensatingControl is required");
    }
    const decidedOn = input.decidedOn ?? context.decidedOn;
    if (!isIsoDate(decidedOn)) {
      throw new LedgerError("INVALID_WAIVER", `decidedOn (${decidedOn}) must be a real date in YYYY-MM-DD form`);
    }
    if (!input.expiresOn || input.expiresOn.trim().length === 0) {
      throw new LedgerError("INVALID_WAIVER", "expiresOn is required: a waiver is a decision with an end date");
    }
    if (!isIsoDate(input.expiresOn)) {
      throw new LedgerError("INVALID_WAIVER", `expiresOn (${input.expiresOn}) must be a real date in YYYY-MM-DD form`);
    }
    if (input.expiresOn < decidedOn) {
      throw new LedgerError("INVALID_WAIVER", `expiresOn (${input.expiresOn}) cannot be before decidedOn (${decidedOn})`);
    }
    const key = findingKey2(finding);
    const seq = ledger.entries.length + 1;
    const prevHash = ledger.entries.length === 0 ? "GENESIS" : ledger.entries[ledger.entries.length - 1].hash;
    const idSource = JSON.stringify([seq, "waived", key, decidedOn, prevHash]);
    const idHash = createHash("sha256").update(idSource).digest("hex");
    const id = idHash.slice(0, 16);
    const entry = {
      seq,
      id,
      decision: "waived",
      findingKey: key,
      code: finding.code,
      recordIndex: finding.recordIndex,
      field: finding.field,
      reference: finding.reference,
      owner: input.owner.trim(),
      reason: input.reason.trim(),
      compensatingControl: input.compensatingControl.trim(),
      decidedOn,
      expiresOn: input.expiresOn,
      fingerprint: context.fingerprint,
      prevHash,
      hash: ""
      // placeholder, will be computed
    };
    entry.hash = hashEntry(entry);
    const next = { version: 1, entries: [...ledger.entries, entry] };
    return { ...next, head: ledgerDigest(next) };
  }
  function appendRelease(ledger, input, waiverId) {
    if (!input.owner || input.owner.trim().length === 0) {
      throw new LedgerError("INVALID_RELEASE", "owner is required");
    }
    if (!input.reason || input.reason.trim().length === 0) {
      throw new LedgerError("INVALID_RELEASE", "reason is required");
    }
    const waived = ledger.entries.find((e) => e.id === waiverId);
    if (!waived) {
      throw new LedgerError("WAIVER_NOT_FOUND", `waiver id ${waiverId} not found`);
    }
    if (waived.decision !== "waived") {
      throw new LedgerError("INVALID_RELEASE", `entry ${waiverId} is not a waiver`);
    }
    const alreadyReleased = ledger.entries.find((e) => e.releaseOf === waiverId && e.decision === "released");
    if (alreadyReleased) {
      throw new LedgerError("ALREADY_RELEASED", `waiver ${waiverId} is already released`);
    }
    const decidedOn = input.decidedOn ?? (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    if (!isIsoDate(decidedOn)) {
      throw new LedgerError("INVALID_RELEASE", `decidedOn (${decidedOn}) must be a real date in YYYY-MM-DD form`);
    }
    const seq = ledger.entries.length + 1;
    const prevHash = ledger.entries[ledger.entries.length - 1].hash;
    const idSource = JSON.stringify([seq, "released", waiverId, decidedOn, prevHash]);
    const idHash = createHash("sha256").update(idSource).digest("hex");
    const id = idHash.slice(0, 16);
    const entry = {
      seq,
      id,
      decision: "released",
      findingKey: waived.findingKey,
      code: waived.code,
      recordIndex: waived.recordIndex,
      field: waived.field,
      reference: waived.reference,
      owner: input.owner.trim(),
      reason: input.reason.trim(),
      compensatingControl: input.control?.trim() ?? "",
      decidedOn,
      releaseOf: waiverId,
      fingerprint: waived.fingerprint,
      prevHash,
      hash: ""
      // placeholder
    };
    entry.hash = hashEntry(entry);
    const next = { version: 1, entries: [...ledger.entries, entry] };
    return { ...next, head: ledgerDigest(next) };
  }
  function classify(findings, ledger, onDate) {
    if (!isIsoDate(onDate)) {
      throw new LedgerError("INVALID_DATE", `classification date (${onDate}) must be a real date in YYYY-MM-DD form`);
    }
    const verify = verifyLedger(ledger);
    if (!verify.ok) {
      throw new LedgerError("LEDGER_CORRUPTED", `Ledger failed verification at seq ${verify.firstInvalidSeq}: ${verify.detail}`);
    }
    const findingsByKey = /* @__PURE__ */ new Map();
    for (const f of findings) {
      const key = findingKey2(f);
      findingsByKey.set(key, f);
    }
    for (const entry of ledger.entries) {
      if (entry.decision === "waived" && !findingsByKey.has(entry.findingKey)) {
        throw new LedgerError("WAIVER_NOT_MATCHING", `Waiver seq ${entry.seq} (id ${entry.id}) references finding ${entry.findingKey} which is not in the report`);
      }
    }
    const entries = [];
    const counts = { OPEN: 0, WAIVED: 0, EXPIRED: 0, RELEASED: 0 };
    for (const finding of findings) {
      const key = findingKey2(finding);
      let status = "OPEN";
      let waiverId;
      let expiresOn;
      for (let i = ledger.entries.length - 1; i >= 0; i--) {
        const entry = ledger.entries[i];
        if (entry.findingKey === key) {
          if (entry.decision === "released") {
            status = "RELEASED";
            break;
          } else if (entry.decision === "waived") {
            const release = ledger.entries.find((e) => e.decision === "released" && e.releaseOf === entry.id);
            if (release) {
              status = "RELEASED";
            } else if (entry.expiresOn && entry.expiresOn < onDate) {
              status = "EXPIRED";
            } else {
              status = "WAIVED";
              waiverId = entry.id;
              expiresOn = entry.expiresOn;
            }
            break;
          }
        }
      }
      counts[status]++;
      entries.push({
        findingKey: key,
        code: finding.code,
        recordIndex: finding.recordIndex,
        field: finding.field,
        reference: finding.reference,
        status,
        ...waiverId ? { waiverId } : {},
        ...expiresOn ? { expiresOn } : {}
      });
    }
    return {
      entries,
      counts,
      // A released or expired exception is back in front of a human (design 13.4): the
      // finding still exists, and no waiver currently covers it.
      unadjudicated: counts.OPEN + counts.EXPIRED + counts.RELEASED
    };
  }

  // src/static/samples.generated.ts
  var COPYBOOKS = [
    {
      "name": "820-packed.cpy",
      "base64": "ICAgICAgKiBOT1JUSFdJTkQgUEFZIC0gRURJIDgyMCBQQVlNRU5UIE9SREVSLCBFUlAgRVhQT1JUIFZBUklBTlQgKFNZTlRIRVRJQyBGSVhUVVJFKQogICAgICAqIFNhbWUgWDEyIDgyMCBtZWFuaW5nIGFzIDgyMC5jcHksIGRpZmZlcmVudCBieXRlIGNvbnRyYWN0OgogICAgICAqICAgQU1PVU5UIGlzIENPTVAtMyBwYWNrZWQgZGVjaW1hbCAoNyBieXRlcykgaW5zdGVhZCBvZiBkaXNwbGF5ICsgb3ZlcnB1bmNoICgxMykuCiAgICAgICogRml4ZWQgd2lkdGg6IDg4IGJ5dGVzIHBlciByZWNvcmQsIHJlY29yZHMgcGFja2VkIGJhY2sgdG8gYmFjayB3aXRoIG5vIGxpbmUgYnJlYWtzCiAgICAgICogKGFuIHVuYmxvY2tlZCBtYWluZnJhbWUgc3RyZWFtIC0gdGhpcyBpcyB3aHkgdGhlIGNvcHlib29rLCBub3QgdGhlIG5ld2xpbmUsIGZyYW1lcyByZWNvcmRzKS4KICAgICAgKgogICAgICAqIEBmcmFtaW5nIGZpeGVkCiAgICAgICogQHNlbWFudGljcyBhbW91bnQ9QU1PVU5UIGN1cnJlbmN5PUNVUlJFTkNZIHZhbHVlRGF0ZT1WQUxVRS1EQVRFIGRhdGVGb3JtYXQ9Q0NZWU1NREQgcmVmZXJlbmNlPVJFRkVSRU5DRSB0cmFuc2FjdGlvblR5cGU9VFhOLVRZUEUgY3JlZGl0VmFsdWU9QyBkZWJpdFZhbHVlPUQKICAgICAgKiBAY29udHJvbCB0eXBlRmllbGQ9UkVDLVRZUEUgdHJhaWxlclZhbHVlPVQgY291bnRGaWVsZD1SRUMtQ09VTlQgdG90YWxGaWVsZD1BTU9VTlQgY3VycmVuY3lGaWVsZD1DVVJSRU5DWQogICAgICAqCiAgICAgICAwMSAgUEFZTUVOVC1SRUNPUkQtUEFDS0VELgogICAgICAgICAgIDA1ICBSRUMtVFlQRSAgICAgICAgICAgIFBJQyBYKDEpLgogICAgICAgICAgIDA1ICBPUklHLUlEICAgICAgICAgICAgIFBJQyBYKDEwKS4KICAgICAgICAgICAwNSAgUkVDRUlWRVItSUQgICAgICAgICBQSUMgWCgxMCkuCiAgICAgICAgICAgMDUgIFRYTi1UWVBFICAgICAgICAgICAgUElDIFgoMikuCiAgICAgICAgICAgMDUgIEFNT1VOVCAgICAgICAgICAgICAgUElDIFM5KDExKVY5OSBDT01QLTMuCiAgICAgICAgICAgMDUgIENVUlJFTkNZICAgICAgICAgICAgUElDIFgoMykuCiAgICAgICAgICAgMDUgIFZBTFVFLURBVEUgICAgICAgICAgUElDIDkoOCkuCiAgICAgICAgICAgMDUgIFJFRkVSRU5DRSAgICAgICAgICAgUElDIFgoMTUpLgogICAgICAgICAgIDA1ICBSRUMtQ09VTlQgICAgICAgICAgIFBJQyA5KDYpLgogICAgICAgICAgIDA1ICBGSUxMRVIgICAgICAgICAgICAgIFBJQyBYKDI2KS4K",
      "bytes": 1248
    },
    {
      "name": "820-redefines.cpy",
      "base64": "ICAgICAgKiBOT1JUSFdJTkQgUEFZIC0gRURJIDgyMCBQQVlNRU5UIE9SREVSLCBCQU5LIERJQUxFQ1QgKFNZTlRIRVRJQyBGSVhUVVJFKQogICAgICAqIEZpeGVkIHdpZHRoOiAxMDEgYnl0ZXMgcGVyIHJlY29yZCwgbGluZSBmcmFtaW5nLCBBU0NJSSB0cmFuc2xpdGVyYXRpb24uCiAgICAgICoKICAgICAgKiBUaGlzIGlzIHRoZSBjb3B5Ym9vayBzaGFwZSBhIGJhbmsgYWN0dWFsbHkgc2VuZHM6IHRoZSBvbmUgYnl0ZSBhZnRlciBSRUMtVFlQRQogICAgICAqIGlzIGZvbGxvd2VkIGJ5IGEgMTAwLWJ5dGUgYXJlYSB3aG9zZSBtZWFuaW5nIGRlcGVuZHMgb24gdGhlIHJlY29yZCB0eXBlLgogICAgICAqICAgUCAgLT4gUEFZTUVOVC1ERVRBSUwgICAodGhlIHBheW1lbnQgaXRzZWxmKQogICAgICAqICAgVCAgLT4gUEFZTUVOVC1UUkFJTEVSICAoUkVDLUNPVU5UIGFuZCBUT1RBTC1BTU9VTlQgZm9yIHRoZSBmaWxlKQogICAgICAqIFRoZSB0cmFpbGVyIGlzIGRlY2xhcmVkIHdpdGggUkVERUZJTkVTIGJlY2F1c2UgaXQgb2NjdXBpZXMgdGhlIHNhbWUgMTAwIGJ5dGVzLgogICAgICAqCiAgICAgICogQSBSRURFRklORVMgaXRlbSBpcyBhIGxheW91dCwgbm90IGEgZ3Vlc3M6IGVhY2ggbGF5b3V0IHNheXMsIGluIHRoZSBAdmlldwogICAgICAqIGRpcmVjdGl2ZXMgYmVsb3csIHdoaWNoIHZhbHVlIG9mIFJFQy1UWVBFIHNlbGVjdHMgaXQuIEEgY29weWJvb2sgdGhhdCBkZWNsYXJlcwogICAgICAqIFJFREVGSU5FUyB3aXRob3V0IHRoYXQgcnVsZSBpcyByZWZ1c2VkIGluc3RlYWQgb2YgcmVhZCBhcyB3aGljaGV2ZXIgbGF5b3V0IGZpdHMuCiAgICAgICoKICAgICAgKiBAZnJhbWluZyBsaW5lCiAgICAgICogQHNlbWFudGljcyBhbW91bnQ9QU1PVU5UIGN1cnJlbmN5PUNVUlJFTkNZIHZhbHVlRGF0ZT1WQUxVRS1EQVRFIGRhdGVGb3JtYXQ9Q0NZWU1NREQgcmVmZXJlbmNlPVJFRkVSRU5DRSB0cmFuc2FjdGlvblR5cGU9VFhOLVRZUEUgY3JlZGl0VmFsdWU9QyBkZWJpdFZhbHVlPUQKICAgICAgKiBAY29udHJvbCB0eXBlRmllbGQ9UkVDLVRZUEUgdHJhaWxlclZhbHVlPVQgY291bnRGaWVsZD1SRUMtQ09VTlQgdG90YWxGaWVsZD1UT1RBTC1BTU9VTlQgY3VycmVuY3lGaWVsZD1UT1RBTC1DVVJSRU5DWQogICAgICAqIEB2aWV3IGxheW91dD1QQVlNRU5ULURFVEFJTCB0eXBlRmllbGQ9UkVDLVRZUEUgdmFsdWU9UAogICAgICAqIEB2aWV3IGxheW91dD1QQVlNRU5ULVRSQUlMRVIgdHlwZUZpZWxkPVJFQy1UWVBFIHZhbHVlPVQKICAgICAgKgogICAgICAgMDEgIFBBWU1FTlQtUkVDT1JELgogICAgICAgICAgIDA1ICBSRUMtVFlQRSAgICAgICAgICAgIFBJQyBYKDEpLgogICAgICAgICAgIDA1ICBSRUNPUkQtQk9EWS4KICAgICAgICAgICAgICAgMTAgIFBBWU1FTlQtREVUQUlMLgogICAgICAgICAgICAgICAgICAgMTUgIE9SSUctSUQgICAgICAgICBQSUMgWCgxMCkuCiAgICAgICAgICAgICAgICAgICAxNSAgUkVDRUlWRVItSUQgICAgIFBJQyBYKDEwKS4KICAgICAgICAgICAgICAgICAgIDE1ICBUWE4tVFlQRSAgICAgICAgUElDIFgoMikuCiAgICAgICAgICAgICAgICAgICAxNSAgQU1PVU5UICAgICAgICAgIFBJQyBTOSgxMSlWOTkgU0lHTiBUUkFJTElORyBPVkVSUFVOQ0guCiAgICAgICAgICAgICAgICAgICAxNSAgQ1VSUkVOQ1kgICAgICAgIFBJQyBYKDMpLgogICAgICAgICAgICAgICAgICAgMTUgIFZBTFVFLURBVEUgICAgICBQSUMgOSg4KS4KICAgICAgICAgICAgICAgICAgIDE1ICBSRUZFUkVOQ0UgICAgICAgUElDIFgoMTUpLgogICAgICAgICAgICAgICAgICAgMTUgIEZJTExFUiAgICAgICAgICBQSUMgWCgzOSkuCiAgICAgICAgICAgICAgIDEwICBQQVlNRU5ULVRSQUlMRVIgUkVERUZJTkVTIFBBWU1FTlQtREVUQUlMLgogICAgICAgICAgICAgICAgICAgMTUgIE9SSUctSUQtVCAgICAgICBQSUMgWCgxMCkuCiAgICAgICAgICAgICAgICAgICAxNSAgUkVDRUlWRVItSUQtVCAgIFBJQyBYKDEwKS4KICAgICAgICAgICAgICAgICAgIDE1ICBUT1RBTC1BTU9VTlQgICAgUElDIFM5KDExKVY5OSBTSUdOIFRSQUlMSU5HIE9WRVJQVU5DSC4KICAgICAgICAgICAgICAgICAgIDE1ICBUT1RBTC1DVVJSRU5DWSAgUElDIFgoMykuCiAgICAgICAgICAgICAgICAgICAxNSAgUkVDLUNPVU5UICAgICAgIFBJQyA5KDYpLgogICAgICAgICAgICAgICAgICAgMTUgIEZJTExFUiAgICAgICAgICBQSUMgWCg1OCkuCg==",
      "bytes": 2218
    },
    {
      "name": "820.cpy",
      "base64": "ICAgICAgKiBOT1JUSFdJTkQgUEFZIC0gRURJIDgyMCBQQVlNRU5UIE9SREVSIChTWU5USEVUSUMgRklYVFVSRSAtIE5PVCBSRUFMIEJBTksgREFUQSkKICAgICAgKiBGaXhlZCB3aWR0aDogMTAwIGJ5dGVzIHBlciByZWNvcmQsIGxpbmUgZnJhbWluZywgQVNDSUkgdHJhbnNsaXRlcmF0aW9uLgogICAgICAqIFJlY29yZCB0eXBlczogJ1AnID0gcGF5bWVudCBkZXRhaWwsICdUJyA9IGNvbnRyb2wgdHJhaWxlci4KICAgICAgKiBUaGUgYW1vdW50J3Mgc2lnbiBpcyBhIHRyYWlsaW5nIG92ZXJwdW5jaCBvbiBpdHMgbGFzdCBkaWdpdAogICAgICAqICh7ID0gKzAsIH0gPSAtMCwgQS4uSSA9ICsxLi4rOSwgSi4uUiA9IC0xLi4tOSkuCiAgICAgICogRGViaXQvY3JlZGl0IGRpcmVjdGlvbiBjb21lcyBmcm9tIFRYTi1UWVBFLCBuZXZlciBmcm9tIHRoZSBzaWduIGFsb25lLgogICAgICAqCiAgICAgICogQGZyYW1pbmcgbGluZQogICAgICAqIEBzZW1hbnRpY3MgYW1vdW50PUFNT1VOVCBjdXJyZW5jeT1DVVJSRU5DWSB2YWx1ZURhdGU9VkFMVUUtREFURSBkYXRlRm9ybWF0PUNDWVlNTUREIHJlZmVyZW5jZT1SRUZFUkVOQ0UgdHJhbnNhY3Rpb25UeXBlPVRYTi1UWVBFIGNyZWRpdFZhbHVlPUMgZGViaXRWYWx1ZT1ECiAgICAgICogQGNvbnRyb2wgdHlwZUZpZWxkPVJFQy1UWVBFIHRyYWlsZXJWYWx1ZT1UIGNvdW50RmllbGQ9UkVDLUNPVU5UIHRvdGFsRmllbGQ9QU1PVU5UIGN1cnJlbmN5RmllbGQ9Q1VSUkVOQ1kKICAgICAgKgogICAgICAgMDEgIFBBWU1FTlQtUkVDT1JELgogICAgICAgICAgIDA1ICBSRUMtVFlQRSAgICAgICAgICAgIFBJQyBYKDEpLgogICAgICAgICAgIDA1ICBPUklHLUlEICAgICAgICAgICAgIFBJQyBYKDEwKS4KICAgICAgICAgICAwNSAgUkVDRUlWRVItSUQgICAgICAgICBQSUMgWCgxMCkuCiAgICAgICAgICAgMDUgIFRYTi1UWVBFICAgICAgICAgICAgUElDIFgoMikuCiAgICAgICAgICAgMDUgIEFNT1VOVCAgICAgICAgICAgICAgUElDIFM5KDExKVY5OSBTSUdOIFRSQUlMSU5HIE9WRVJQVU5DSC4KICAgICAgICAgICAwNSAgQ1VSUkVOQ1kgICAgICAgICAgICBQSUMgWCgzKS4KICAgICAgICAgICAwNSAgVkFMVUUtREFURSAgICAgICAgICBQSUMgOSg4KS4KICAgICAgICAgICAwNSAgUkVGRVJFTkNFICAgICAgICAgICBQSUMgWCgxNSkuCiAgICAgICAgICAgMDUgIFJFQy1DT1VOVCAgICAgICAgICAgUElDIDkoNikuCiAgICAgICAgICAgMDUgIEZJTExFUiAgICAgICAgICAgICAgUElDIFgoMzIpLgo=",
      "bytes": 1262
    },
    {
      "name": "823.cpy",
      "base64": "ICAgICAgKiBOT1JUSFdJTkQgUEFZIC0gQkFOSyBTSURFIDgyMyBSRU1JVFRBTkNFIENPTkZJUk1BVElPTiAoU1lOVEhFVElDIEZJWFRVUkUpCiAgICAgICogRml4ZWQgd2lkdGg6IDgwIGJ5dGVzIHBlciByZWNvcmQsIGxpbmUgZnJhbWluZywgQVNDSUkgdHJhbnNsaXRlcmF0aW9uLgogICAgICAqIFJlY29yZCB0eXBlczogJ0QnID0gZGV0YWlsLCAnVCcgPSBjb250cm9sIHRyYWlsZXIuCiAgICAgICogVGhlIGFtb3VudCdzIHNpZ24gaXMgYSBzZXBhcmF0ZSBsZWFkaW5nIGNoYXJhY3RlciAoJysnLCAnLScgb3Igc3BhY2UpLAogICAgICAqIGEgZGlmZmVyZW50IGNvbnZlbnRpb24gZnJvbSB0aGUgODIwIGZpbGUgLSB0aGUgY29weWJvb2sgZGVjaWRlcywgbm90IHRoZSBwYXJzZXIuCiAgICAgICoKICAgICAgKiBAZnJhbWluZyBsaW5lCiAgICAgICogQHNlbWFudGljcyBhbW91bnQ9QU1PVU5UIGN1cnJlbmN5PUNVUlJFTkNZIHZhbHVlRGF0ZT1WQUxVRS1EQVRFIGRhdGVGb3JtYXQ9Q0NZWU1NREQgcmVmZXJlbmNlPUJBTkstUkVGCiAgICAgICogQGNvbnRyb2wgdHlwZUZpZWxkPVJFQy1UWVBFIHRyYWlsZXJWYWx1ZT1UIGNvdW50RmllbGQ9UkVDLUNPVU5UIHRvdGFsRmllbGQ9QU1PVU5UIGN1cnJlbmN5RmllbGQ9Q1VSUkVOQ1kKICAgICAgKgogICAgICAgMDEgIEJBTkstUkVDT1JELgogICAgICAgICAgIDA1ICBSRUMtVFlQRSAgICAgICAgICAgIFBJQyBYKDEpLgogICAgICAgICAgIDA1ICBPUklHLUlEICAgICAgICAgICAgIFBJQyBYKDEwKS4KICAgICAgICAgICAwNSAgUkVDRUlWRVItSUQgICAgICAgICBQSUMgWCgxMCkuCiAgICAgICAgICAgMDUgIENVUlJFTkNZICAgICAgICAgICAgUElDIFgoMykuCiAgICAgICAgICAgMDUgIEFNT1VOVCAgICAgICAgICAgICAgUElDIFM5KDExKVY5OSBTSUdOIExFQURJTkcgU0VQQVJBVEUuCiAgICAgICAgICAgMDUgIFZBTFVFLURBVEUgICAgICAgICAgUElDIDkoOCkuCiAgICAgICAgICAgMDUgIEJBTkstUkVGICAgICAgICAgICAgUElDIFgoMTUpLgogICAgICAgICAgIDA1ICBSRUMtQ09VTlQgICAgICAgICAgIFBJQyA5KDYpLgogICAgICAgICAgIDA1ICBGSUxMRVIgICAgICAgICAgICAgIFBJQyBYKDEzKS4K",
      "bytes": 1110
    }
  ];
  var DATA = [
    {
      "name": "820-bad.txt",
      "base64": "UE5XUEFZMDAwMDFHUkVFTkZJRUxEQyAwMDAwMDE1MDAwMDB7VVNEMjAyNjExMThOV1AtMjYxMS0wMDAxICAwMDAwMDAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIApQTldQQVkwMDAwMUhBUkJPUi1GUkVDIDAwMDAwMDk5MDUwMHtVU0QyMDI2MTExOE5XUC0yNjExLTAwMDIgIDAwMDAwMCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgClBOV1BBWTAwMDAxQkxVRS1SSURHRUMgMDAwMDAyMDAwMDAwe1VTRDIwMjYxMTE0TldQLTI2MTEtMDAwMyAgMDAwMDAwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFDRURBUi1DT05TQyAwMDAwMDA4NzUwMDB7VVNEMjAyNjExMTlOV1AtMjYxMS0wMDA0ICAwMDAwMDAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIApQTldQQVkwMDAwMU5PUlRIU1RBUi1DIDAwMDAwMTIwMDAwMHtVU0QyMDI2MTExOU5XUC0yNjExLTAwMDUgIDAwMDAwMCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgClBOV1BBWTAwMDAxU1VNTUlULUhBUkMgMDAwMDAzMTAwMDAwe1VTRDIwMjYxMTIwTldQLTI2MTEtMDAwNiAgMDAwMDAwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFMQUtFU0lERS1QQyAwMDAwMDA2NjAwMDB7VVNEMjAyNjExMjBOV1AtMjYxMS0wMDA3ICAwMDAwMDAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgClBOV1BBWTAwMDAxUElORUhVUlNULUMgMDAwMDAwNDQ5MDAwe1VTRDIwMjYxMTIwTldQLTI2MTEtMDAwOCAgMDAwMDAwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFBVExBUy1TVEFGQyAwMDAwMDEyNzk5OTlJVVNEMjAyNjExMjBOV1AtMjYxMS0wMDA5ICAwMDAwMDAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIApQTldQQVkwMDAwMVJJVkVSU1RPTkVDIDAwMDAwMDc5MDAwMEFVU0QyMDI2MTEyME5XUC0yNjExLTAwMTEgIDAwMDAwMCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgClROV1BBWTAwMDAxQkFOSy1TVExNVEMgMDAwMDEyODQ1NTAwe1VTRDIwMjYxMTIwQ1RMLTgyMC1UUkFJTEVSMDAwMDEwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAK",
      "bytes": 1110
    },
    {
      "name": "820-good.txt",
      "base64": "UE5XUEFZMDAwMDFHUkVFTkZJRUxEQyAwMDAwMDE1MDAwMDB7VVNEMjAyNjExMThOV1AtMjYxMS0wMDAxICAwMDAwMDAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIApQTldQQVkwMDAwMUhBUkJPUi1GUkVDIDAwMDAwMDk5MDUwMHtVU0QyMDI2MTExOE5XUC0yNjExLTAwMDIgIDAwMDAwMCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgClBOV1BBWTAwMDAxQkxVRS1SSURHRUMgMDAwMDAyMDAwMDAwe1VTRDIwMjYxMTE5TldQLTI2MTEtMDAwMyAgMDAwMDAwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFDRURBUi1DT05TQyAwMDAwMDA4NzUwMDB7VVNEMjAyNjExMTlOV1AtMjYxMS0wMDA0ICAwMDAwMDAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIApQTldQQVkwMDAwMU5PUlRIU1RBUi1DIDAwMDAwMTIwMDAwMHtVU0QyMDI2MTExOU5XUC0yNjExLTAwMDUgIDAwMDAwMCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgClBOV1BBWTAwMDAxU1VNTUlULUhBUkMgMDAwMDAzMTAwMDAwe1VTRDIwMjYxMTIwTldQLTI2MTEtMDAwNiAgMDAwMDAwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFMQUtFU0lERS1QQyAwMDAwMDA2NjAwMDB7VVNEMjAyNjExMjBOV1AtMjYxMS0wMDA3ICAwMDAwMDAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIApQTldQQVkwMDAwMVBJTkVIVVJTVC1DIDAwMDAwMDQ1MDAwMHtVU0QyMDI2MTEyME5XUC0yNjExLTAwMDggIDAwMDAwMCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgClBOV1BBWTAwMDAxQVRMQVMtU1RBRkMgMDAwMDAxMjgwMDAwe1VTRDIwMjYxMTIwTldQLTI2MTEtMDAwOSAgMDAwMDAwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFSSVZFUlNUT05FQyAwMDAwMDA3OTAwMDB7VVNEMjAyNjExMjBOV1AtMjYxMS0wMDEwICAwMDAwMDAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIApUTldQQVkwMDAwMUJBTkstU1RMTVRDIDAwMDAxMjg0NTUwMHtVU0QyMDI2MTEyMENUTC04MjAtVFJBSUxFUjAwMDAxMCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCg==",
      "bytes": 1111
    },
    {
      "name": "820-packed-good.txt",
      "base64": "UE5XUEFZMDAwMDFHUkVFTkZJRUxEQyAAAAFQAAAMVVNEMjAyNjExMThOV1AtMjYxMS0wMDAxICAwMDAwMDAgICAgICAgICAgICAgICAgICAgICAgICAgIFBOV1BBWTAwMDAxSEFSQk9SLUZSRUMgAAAAmQUADFVTRDIwMjYxMTE4TldQLTI2MTEtMDAwMiAgMDAwMDAwICAgICAgICAgICAgICAgICAgICAgICAgICBQTldQQVkwMDAwMUJMVUUtUklER0VDIAAAAgAAAAxVU0QyMDI2MTExOU5XUC0yNjExLTAwMDMgIDAwMDAwMCAgICAgICAgICAgICAgICAgICAgICAgICAgUE5XUEFZMDAwMDFDRURBUi1DT05TQyAAAACHUAAMVVNEMjAyNjExMTlOV1AtMjYxMS0wMDA0ICAwMDAwMDAgICAgICAgICAgICAgICAgICAgICAgICAgIFBOV1BBWTAwMDAxTk9SVEhTVEFSLUMgAAABIAAADFVTRDIwMjYxMTE5TldQLTI2MTEtMDAwNSAgMDAwMDAwICAgICAgICAgICAgICAgICAgICAgICAgICBQTldQQVkwMDAwMVNVTU1JVC1IQVJDIAAAAxAAAAxVU0QyMDI2MTEyME5XUC0yNjExLTAwMDYgIDAwMDAwMCAgICAgICAgICAgICAgICAgICAgICAgICAgUE5XUEFZMDAwMDFMQUtFU0lERS1QQyAAAABmAAAMVVNEMjAyNjExMjBOV1AtMjYxMS0wMDA3ICAwMDAwMDAgICAgICAgICAgICAgICAgICAgICAgICAgIFBOV1BBWTAwMDAxUElORUhVUlNULUMgAAAARQAADFVTRDIwMjYxMTIwTldQLTI2MTEtMDAwOCAgMDAwMDAwICAgICAgICAgICAgICAgICAgICAgICAgICBQTldQQVkwMDAwMUFUTEFTLVNUQUZDIAAAASgAAAxVU0QyMDI2MTEyME5XUC0yNjExLTAwMDkgIDAwMDAwMCAgICAgICAgICAgICAgICAgICAgICAgICAgUE5XUEFZMDAwMDFSSVZFUlNUT05FQyAAAAB5AAAMVVNEMjAyNjExMjBOV1AtMjYxMS0wMDEwICAwMDAwMDAgICAgICAgICAgICAgICAgICAgICAgICAgIFROV1BBWTAwMDAxQkFOSy1TVExNVEMgAAAShFUADFVTRDIwMjYxMTIwQ1RMLTgyMC1UUkFJTEVSMDAwMDEwICAgICAgICAgICAgICAgICAgICAgICAgICA=",
      "bytes": 968
    },
    {
      "name": "820-redefines-bad.txt",
      "base64": "UE5XUEFZMDAwMDFHUkVFTkZJRUxEQyAwMDAwMDE1MDAwMDB7VVNEMjAyNjExMThOV1AtMjYxMS0wMDAxICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFIQVJCT1ItRlJFQyAwMDAwMDA5OTA1MDB7VVNEMjAyNjExMThOV1AtMjYxMS0wMDAyICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFCTFVFLVJJREdFQyAwMDAwMDIwMDAwMDB7VVNEMjAyNjExMTlOV1AtMjYxMS0wMDAzICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFDRURBUi1DT05TQyAwMDAwMDA4NzUwMDB7VVNEMjAyNjExMTlOV1AtMjYxMS0wMDA0ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFOT1JUSFNUQVItQyAwMDAwMDEyMDAwMDB7VVNEMjAyNjExMTlOV1AtMjYxMS0wMDA1ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFTVU1NSVQtSEFSQyAwMDAwMDMxMDAwMDB7VVNEMjAyNjExMjBOV1AtMjYxMS0wMDA2ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFMQUtFU0lERS1QQyAwMDAwMDA2NjAwMDB7VVNEMjAyNjExMjBOV1AtMjYxMS0wMDA3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFQSU5FSFVSU1QtQyAwMDAwMDA0NTAwMDB7VVNEMjAyNjExMjBOV1AtMjYxMS0wMDA4ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFBVExBUy1TVEFGQyAwMDAwMDEyODAwMDB7VVNEMjAyNjExMjBOV1AtMjYxMS0wMDA5ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFSSVZFUlNUT05FQyAwMDAwMDA3OTAwMDB7VVNEMjAyNjExMjBOV1AtMjYxMS0wMDEwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKVE5XUEFZMDAwMDFCQU5LLVNUTE1UMDAwMDEyODQ0NTAwe1VTRDAwMDAxMCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAK",
      "bytes": 1122
    },
    {
      "name": "820-redefines-good.txt",
      "base64": "UE5XUEFZMDAwMDFHUkVFTkZJRUxEQyAwMDAwMDE1MDAwMDB7VVNEMjAyNjExMThOV1AtMjYxMS0wMDAxICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFIQVJCT1ItRlJFQyAwMDAwMDA5OTA1MDB7VVNEMjAyNjExMThOV1AtMjYxMS0wMDAyICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFCTFVFLVJJREdFQyAwMDAwMDIwMDAwMDB7VVNEMjAyNjExMTlOV1AtMjYxMS0wMDAzICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFDRURBUi1DT05TQyAwMDAwMDA4NzUwMDB7VVNEMjAyNjExMTlOV1AtMjYxMS0wMDA0ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFOT1JUSFNUQVItQyAwMDAwMDEyMDAwMDB7VVNEMjAyNjExMTlOV1AtMjYxMS0wMDA1ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFTVU1NSVQtSEFSQyAwMDAwMDMxMDAwMDB7VVNEMjAyNjExMjBOV1AtMjYxMS0wMDA2ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFMQUtFU0lERS1QQyAwMDAwMDA2NjAwMDB7VVNEMjAyNjExMjBOV1AtMjYxMS0wMDA3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFQSU5FSFVSU1QtQyAwMDAwMDA0NTAwMDB7VVNEMjAyNjExMjBOV1AtMjYxMS0wMDA4ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFBVExBUy1TVEFGQyAwMDAwMDEyODAwMDB7VVNEMjAyNjExMjBOV1AtMjYxMS0wMDA5ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKUE5XUEFZMDAwMDFSSVZFUlNUT05FQyAwMDAwMDA3OTAwMDB7VVNEMjAyNjExMjBOV1AtMjYxMS0wMDEwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKVE5XUEFZMDAwMDFCQU5LLVNUTE1UMDAwMDEyODQ1NTAwe1VTRDAwMDAxMCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAK",
      "bytes": 1122
    },
    {
      "name": "823-bad.txt",
      "base64": "RE5XUEFZMDAwMDFHUkVFTkZJRUxEVVNEKzAwMDAwMTUwMDAwMDAyMDI2MTExOE5XUC0yNjExLTAwMDEgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFIQVJCT1ItRlJFVVNEKzAwMDAwMDk5MDUwMDAyMDI2MTExOE5XUC0yNjExLTAwMDIgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFCTFVFLVJJREdFVVNEKzAwMDAwMjAwMDAwMDAyMDI2MTExOU5XUC0yNjExLTAwMDMgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFDRURBUi1DT05TVVNEKzAwMDAwMDg3NTAwMDAyMDI2MTExOU5XUC0yNjExLTAwMDQgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFOT1JUSFNUQVItVVNEKzAwMDAwMTIwMDAwMDAyMDI2MTExOU5XUC0yNjExLTAwMDUgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFTVU1NSVQtSEFSVVNEKzAwMDAwMzEwMDAwMDAyMDI2MTEyME5XUC0yNjExLTAwMDYgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFMQUtFU0lERS1QVVNEKzAwMDAwMDY2MDAwMDAyMDI2MTEyME5XUC0yNjExLTAwMDcgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFBVExBUy1TVEFGVVNEKzAwMDAwMTI4MDAwMDAyMDI2MTEyME5XUC0yNjExLTAwMDkgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFSSVZFUlNUT05FVVNEKzAwMDAwMDc5MDAwMDAyMDI2MTEyME5XUC0yNjExLTAwMTAgIDAwMDAwMCAgICAgICAgICAgICAKVE5XUEFZMDAwMDFCQU5LLVNUTE1UVVNEKzAwMDAxMjg0NTUwMDAyMDI2MTEyMENUTC04MjMtVFJBSUxFUjAwMDAxMCAgICAgICAgICAgICAK",
      "bytes": 810
    },
    {
      "name": "823-bank.txt",
      "base64": "RE5XUEFZMDAwMDFHUkVFTkZJRUxEVVNEKzAwMDAwMTUwMDAwMDAyMDI2MTExOE5XUC0yNjExLTAwMDEgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFIQVJCT1ItRlJFVVNEKzAwMDAwMDk5MDUwMDAyMDI2MTExOE5XUC0yNjExLTAwMDIgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFCTFVFLVJJREdFVVNEKzAwMDAwMjAwMDAwMDAyMDI2MTExOU5XUC0yNjExLTAwMDMgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFDRURBUi1DT05TVVNEKzAwMDAwMDg3NTAwMDAyMDI2MTExOU5XUC0yNjExLTAwMDQgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFOT1JUSFNUQVItVVNEKzAwMDAwMTIwMDAwMDAyMDI2MTExOU5XUC0yNjExLTAwMDUgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFTVU1NSVQtSEFSVVNEKzAwMDAwMzEwMDAwMDAyMDI2MTEyME5XUC0yNjExLTAwMDYgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFMQUtFU0lERS1QVVNEKzAwMDAwMDY2MDAwMDAyMDI2MTEyME5XUC0yNjExLTAwMDcgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFQSU5FSFVSU1QtVVNEKzAwMDAwMDQ1MDAwMDAyMDI2MTEyME5XUC0yNjExLTAwMDggIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFBVExBUy1TVEFGVVNEKzAwMDAwMTI4MDAwMDAyMDI2MTEyME5XUC0yNjExLTAwMDkgIDAwMDAwMCAgICAgICAgICAgICAKRE5XUEFZMDAwMDFSSVZFUlNUT05FVVNEKzAwMDAwMDc5MDAwMDAyMDI2MTEyME5XUC0yNjExLTAwMTAgIDAwMDAwMCAgICAgICAgICAgICAKVE5XUEFZMDAwMDFCQU5LLVNUTE1UVVNEKzAwMDAxMjg0NTUwMDAyMDI2MTEyMENUTC04MjMtVFJBSUxFUjAwMDAxMCAgICAgICAgICAgICAK",
      "bytes": 891
    },
    {
      "name": "bai2-bad.txt",
      "base64": "MDEsTk9SVEhXTkQsQkFOS1NUTE0sMjYxMTIxLDA5MDAsTldQLTgyMC0yNjExLCwsMgowMixCQU5LU1RMTSxOT1JUSFdORCwxLDI2MTEyMCwwOTAwLFVTRAowMywwMDAwLTgyMDAwMSxVU0QsMTAwLDEyODQ1NTAwMCwxMCxaCjE2LDE2NSwxNTAwMDAwMCxaLE5XUC0yNjExLTAwMDEsTldQLTI2MTEtMDAwMSxTRVRUTEVNRU5UIE5XUC0yNjExLTAwMDEKMTYsMTY1LDk5MDUwMDAsWixOV1AtMjYxMS0wMDAyLE5XUC0yNjExLTAwMDIsU0VUVExFTUVOVCBOV1AtMjYxMS0wMDAyCjE2LDE2NSwyMDAwMDAwMCxaLE5XUC0yNjExLTAwMDMsTldQLTI2MTEtMDAwMyxTRVRUTEVNRU5UIE5XUC0yNjExLTAwMDMKMTYsMTY1LDg3NTAwMDAsWixOV1AtMjYxMS0wMDA0LE5XUC0yNjExLTAwMDQsU0VUVExFTUVOVCBOV1AtMjYxMS0wMDA0CjE2LDE2NSwxMjAwMDAwMCxaLE5XUC0yNjExLTAwMDUsTldQLTI2MTEtMDAwNSxTRVRUTEVNRU5UIE5XUC0yNjExLTAwMDUKMTYsMTY1LDMxMDAwMDAwLFosTldQLTI2MTEtMDAwNixOV1AtMjYxMS0wMDA2LFNFVFRMRU1FTlQgTldQLTI2MTEtMDAwNgoxNiwxNjUsNjYwMDAwMCxaLE5XUC0yNjExLTAwMDcsTldQLTI2MTEtMDAwNyxTRVRUTEVNRU5UIE5XUC0yNjExLTAwMDcKMTYsMTY1LDQ1MDAwMDAsWixOV1AtMjYxMS0wMDA4LE5XUC0yNjExLTAwMDgsU0VUVExFTUVOVCBOV1AtMjYxMS0wMDA4CjE2LDE2NSwxMjgwMDAwMCxaLE5XUC0yNjExLTAwMDksTldQLTI2MTEtMDAwOSxTRVRUTEVNRU5UIE5XUC0yNjExLTAwMDkKMTYsNDA5LDI1MDAsWiwsQkFOSy1GRUUtMjYxMSxNT05USExZIEFDQ09VTlQgRkVFCjQ5LDI1NjkxMDAwMCwxMi8KOTgsMjU2OTEwMDAwLDEsMTQvCjk5LDI1NjkxMDAwMCwxLDE2Lwo=",
      "bytes": 866
    },
    {
      "name": "bai2-good.txt",
      "base64": "MDEsTk9SVEhXTkQsQkFOS1NUTE0sMjYxMTIxLDA5MDAsTldQLTgyMC0yNjExLCwsMgowMixCQU5LU1RMTSxOT1JUSFdORCwxLDI2MTEyMCwwOTAwLFVTRAowMywwMDAwLTgyMDAwMSxVU0QsMTAwLDEyODQ1NTAwMCwxMCxaCjE2LDE2NSwxNTAwMDAwMCxaLE5XUC0yNjExLTAwMDEsTldQLTI2MTEtMDAwMSxTRVRUTEVNRU5UIE5XUC0yNjExLTAwMDEKMTYsMTY1LDk5MDUwMDAsWixOV1AtMjYxMS0wMDAyLE5XUC0yNjExLTAwMDIsU0VUVExFTUVOVCBOV1AtMjYxMS0wMDAyCjE2LDE2NSwyMDAwMDAwMCxaLE5XUC0yNjExLTAwMDMsTldQLTI2MTEtMDAwMyxTRVRUTEVNRU5UIE5XUC0yNjExLTAwMDMKMTYsMTY1LDg3NTAwMDAsWixOV1AtMjYxMS0wMDA0LE5XUC0yNjExLTAwMDQsU0VUVExFTUVOVCBOV1AtMjYxMS0wMDA0CjE2LDE2NSwxMjAwMDAwMCxaLE5XUC0yNjExLTAwMDUsTldQLTI2MTEtMDAwNSxTRVRUTEVNRU5UIE5XUC0yNjExLTAwMDUKMTYsMTY1LDMxMDAwMDAwLFosTldQLTI2MTEtMDAwNixOV1AtMjYxMS0wMDA2LFNFVFRMRU1FTlQgTldQLTI2MTEtMDAwNgoxNiwxNjUsNjYwMDAwMCxaLE5XUC0yNjExLTAwMDcsTldQLTI2MTEtMDAwNyxTRVRUTEVNRU5UIE5XUC0yNjExLTAwMDcKMTYsMTY1LDQ1MDAwMDAsWixOV1AtMjYxMS0wMDA4LE5XUC0yNjExLTAwMDgsU0VUVExFTUVOVCBOV1AtMjYxMS0wMDA4CjE2LDE2NSwxMjgwMDAwMCxaLE5XUC0yNjExLTAwMDksTldQLTI2MTEtMDAwOSxTRVRUTEVNRU5UIE5XUC0yNjExLTAwMDkKMTYsMTY1LDc5MDAwMDAsWixOV1AtMjYxMS0wMDEwLE5XUC0yNjExLTAwMTAsU0VUVExFTUVOVCBOV1AtMjYxMS0wMDEwCjQ5LDI1NjkxMDAwMCwxMi8KOTgsMjU2OTEwMDAwLDEsMTQvCjk5LDI1NjkxMDAwMCwxLDE2Lwo=",
      "bytes": 887
    }
  ];
  var GUARANTEES = {
    "guaranteed": [
      "Format interpretation - each field is sliced exactly at the byte position and length the copybook declares, and every value is reported as the bytes hold it. Three comparisons read a value after trimming surrounding spaces, and they are the only ones: the REDEFINES discriminator (@view), the trailer's record-type check, and the currency code.",
      "One layout per record - a REDEFINES region (one byte range, several layouts) decodes exactly the layout its discriminator selects; an unmatched record is REDEFINES_VIEW_UNMATCHED and its bytes stay undecoded, never guessed.",
      "Arithmetic - amounts are bigint minor units with an ISO-4217 currency; totals and deltas are exact, and never computed in floating point.",
      "Reference reconciliation - every 820 reference either matches a bank record or appears in the report as REF_UNMATCHED; nothing is dropped silently.",
      "Reproducibility - running verify on an output directory re-derives the verdict and compares a SHA-256 fingerprint. Same inputs, same verdict; otherwise the differing field path is printed. When an exception ledger sits beside the report, verify also prints its entry count and head hash and fails if the ledger no longer matches them.",
      "Explanation grounding - an explanation may cite only numbers present in the finding it explains, or it is replaced with INSUFFICIENT_EVIDENCE; the default explainer is a zero-credit template, not a model."
    ],
    "notGuaranteed": [
      "Legal or accounting adequacy of a payment or its remittance advice.",
      "Whether an exception is acceptable - a human must attach a reason, an expiry date, and a compensating control. The tool only refuses to let an exception exist without them.",
      "Coverage of unmodelled clauses - OCCURS DEPENDING ON, binary COMP and SIGN LEADING OVERPUNCH are UNSUPPORTED_STRUCTURE in a copybook; a REDEFINES with no activation rule is COPYBOOK_SEMANTICS; no copybook is SPEC_MISSING. None is guessed. EBCDIC source is not decoded: this build reads ASCII and latin1 bytes, so an EBCDIC file fails the layout and amount checks (RECORD_LENGTH_MISMATCH, FIELD_INVALID_NUMERIC, BAI2_STRUCTURE) and cannot earn a PASS. It is the largest gap for mainframe estates, and reading it is a roadmap item rather than a claim.",
      "Source data authenticity - the tool verifies internal consistency, not whether the bank sent the right file.",
      "The ANSI X12 transaction set - the input is a positional file plus its copybook, or a BAI2 statement. A delimited ANSI X12 transaction set (ST*820*...~), which carries the same 820/823 numbers, is not parsed: there is no segment parser in this build and it is a roadmap item. An 823 is read here as the bank side remittance and lockbox confirmation, not as a receipt saying a payment was made.",
      "An immutable history - the register is a keyless SHA-256 chain: each link hashes the previous hash and the entry, and the head (count and hash) is recorded beside it. That detects an entry that was edited, reordered or cut from the tail, and 820 verify fails on one. It does not prevent the edit. Anyone who can write the ledger file can recompute every hash and the head and produce a file that still verifies, because there is no key the writer lacks and no witness outside the file. This is tamper detection, not proof of an original history: an outside anchor for the head is a roadmap item."
    ],
    "sourcePath": "docs/guarantees.md"
  };

  // src/static/app.ts
  var TODAY = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  var LEDGER_KEY = "820-ledger-v1";
  var SCENARIOS = [
    { id: "S1", name: "820-good + 823-bank", payment: "820-good.txt", copybook: "820.cpy", bank: "823-bank.txt", bankCopybook: "823.cpy", expect: "PASS" },
    { id: "S2", name: "820-packed (COMP-3) + 823-bank", payment: "820-packed-good.txt", copybook: "820-packed.cpy", bank: "823-bank.txt", bankCopybook: "823.cpy", expect: "PASS" },
    { id: "S3", name: "820-bad + 823-bank", payment: "820-bad.txt", copybook: "820.cpy", bank: "823-bank.txt", bankCopybook: "823.cpy", expect: "FAIL" },
    { id: "S4", name: "820-good + 823-bad", payment: "820-good.txt", copybook: "820.cpy", bank: "823-bad.txt", bankCopybook: "823.cpy", expect: "FAIL" },
    { id: "S5", name: "820-good + BAI2 good", payment: "820-good.txt", copybook: "820.cpy", bank: "bai2-good.txt", bankFormat: "bai2", expect: "PASS" },
    { id: "S6", name: "820-good + BAI2 bad", payment: "820-good.txt", copybook: "820.cpy", bank: "bai2-bad.txt", bankFormat: "bai2", expect: "FAIL" },
    { id: "S7", name: "820-redefines good + 823-bank", payment: "820-redefines-good.txt", copybook: "820-redefines.cpy", bank: "823-bank.txt", bankCopybook: "823.cpy", expect: "PASS" },
    { id: "S8", name: "820-redefines bad + 823-bank", payment: "820-redefines-bad.txt", copybook: "820-redefines.cpy", bank: "823-bank.txt", bankCopybook: "823.cpy", expect: "FAIL" }
  ];
  var state = { run: null, ledger: emptyLedger(), selected: -1, picked: false, spotlight: null, droppedFile: null, droppedCopybook: null };
  var el = (id) => document.getElementById(id);
  function esc(text) {
    return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function toast(message) {
    const node = el("toast");
    node.textContent = message;
    node.classList.add("on");
    window.setTimeout(() => node.classList.remove("on"), 2600);
  }
  function bytesOf(name, pool = DATA) {
    const entry = pool.find((sample) => sample.name === name);
    if (!entry) throw new Error(`sample ${name} is not bundled`);
    const binary = atob(entry.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  var copybookOf = (name) => toLatin1(bytesOf(name, COPYBOOKS));
  function summaryOf(role, label, format, copybookPath, result) {
    return {
      role,
      path: label,
      format,
      copybookPath,
      recordLength: result.copybook.recordLength,
      records: result.computedControl.recordCount,
      details: result.computedControl.detailCount,
      fileHash: result.fileHash,
      copybookHash: result.copybookHash,
      fingerprint: result.fingerprint,
      issues: result.issues.map((issue) => ({ ...issue, detail: issue.detail }))
    };
  }
  async function runScenario(id) {
    const scenario = SCENARIOS.find((entry) => entry.id === id);
    if (!scenario) throw new Error(`unknown scenario ${id}`);
    const paymentBytes = bytesOf(scenario.payment);
    const payment = parseFile({
      copybook: compileCopybook(copybookOf(scenario.copybook ?? "820.cpy")),
      source: paymentBytes,
      filename: scenario.payment
    });
    let bank;
    if (scenario.bank) {
      bank = scenario.bankFormat === "bai2" ? parseBai2(bytesOf(scenario.bank)) : parseFile({
        copybook: compileCopybook(copybookOf(scenario.bankCopybook ?? "823.cpy")),
        source: bytesOf(scenario.bank),
        filename: scenario.bank
      });
    }
    await present(scenario.id, payment, bank, scenario);
  }
  async function present(scenarioId, payment, bank, scenario, label) {
    const window2 = readWindow();
    const result = reconcile({
      payment,
      ...bank ? { bank } : {},
      options: { settlementWindow: window2 }
    });
    const explanations = (await explainFindings(result.findings)).explanations;
    const paymentLabel = label?.payment ?? scenario?.payment ?? "(dropped file)";
    const files = {
      payment: summaryOf("payment", paymentLabel, "fixed", label?.copybook ?? scenario?.copybook ?? null, payment),
      ...bank ? { bank: summaryOf("bank", scenario?.bank ?? "(dropped bank)", scenario?.bankFormat ?? "fixed", scenario?.bankCopybook ?? null, bank) } : {}
    };
    const view = buildViewModel({
      payment,
      ...bank ? { bank } : {},
      result,
      files,
      explanations,
      guarantees: { ...GUARANTEES }
    });
    state.run = { view, findings: result.findings, fingerprint: result.fingerprint, scenarioId };
    state.selected = result.findings.length > 0 ? 0 : -1;
    state.picked = false;
    state.spotlight = null;
    render2();
  }
  function readWindow() {
    const raw = el("inpWindow").value.trim();
    const match = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(raw);
    if (!match) {
      throw new Error("the ghost reads windows in one shape only, 2026-11-18..2026-11-20. Fix the box, then press Run dropped again");
    }
    return { start: match[1], end: match[2] };
  }
  async function runDropped() {
    if (!state.droppedFile) {
      toast("nothing to haunt yet: drop a payment file in the top box, then press Run dropped");
      return;
    }
    const format = el("selFormat").value;
    const payment = format === "bai2" ? parseBai2(state.droppedFile.bytes) : parseFile({
      copybook: compileCopybook(state.droppedCopybook ? toLatin1(state.droppedCopybook.bytes) : copybookOf("820.cpy")),
      source: state.droppedFile.bytes,
      filename: state.droppedFile.name
    });
    await present("dropped", payment, void 0, void 0, {
      payment: state.droppedFile.name,
      copybook: state.droppedCopybook?.name ?? null
    });
  }
  function classification() {
    if (!state.run) return null;
    try {
      return classify(state.run.findings, state.ledger, TODAY);
    } catch (error) {
      return null;
    }
  }
  function renderScenarios() {
    el("scenarios").innerHTML = SCENARIOS.map(
      (scenario) => `<button class="scenario ${state.run?.scenarioId === scenario.id ? "on" : ""}" data-id="${scenario.id}">
      <span class="id">${scenario.id}</span>
      <span class="nm">${esc(scenario.name)}</span>
      <span class="exp ${scenario.expect.toLowerCase()}">${scenario.expect}</span>
    </button>`
    ).join("");
  }
  function plainVerdict(view) {
    const total = view.findings.find((finding) => finding.code === "CONTROL_TOTAL_MISMATCH");
    if (view.status === "FAIL" && total?.declared && total.computed) {
      const side = total.evidence.side;
      const details = side === "bank" ? view.files.bank?.details : view.files.payment.details;
      const who = side === "bank" ? "bank" : "payment";
      const delta = total.delta ? `, a difference of <b>${esc(total.delta)}</b>` : "";
      return `The ${who} control trailer declares <b>${esc(total.declared)}</b>. Its ${details} detail records add up to <b>${esc(total.computed)}</b>${delta}.`;
    }
    if (view.status === "FAIL") {
      const first = view.findings[0];
      return `${view.findings.length} finding${view.findings.length === 1 ? "" : "s"}: the first is <b>${esc(first?.code ?? "")}</b> at ${esc(first?.evidence.side ?? "payment")} record <b>${esc(first?.recordIndex ?? "")}</b>.`;
    }
    if (view.status === "INCOMPLETE") {
      const issues = view.summary.blockingParseIssues;
      return `${issues} parse issue${issues === 1 ? "" : "s"}: bytes arrived that no layout explains, so <b>no PASS is earned</b>.`;
    }
    return view.files.bank ? "Every control total, reference and value date agrees, <b>on both sides</b>." : "The payment file reads clean. There is no bank side in this run, so this is <b>not yet a verdict</b> about agreement.";
  }
  function waiverInView() {
    const c = classification();
    if (!c) return null;
    const decided = c.entries.find((entry) => entry.status === "WAIVED" || entry.status === "EXPIRED");
    if (!decided?.waiverId) return null;
    const waiver = state.ledger.entries.find((entry) => entry.id === decided.waiverId);
    if (!waiver) return null;
    return { code: decided.code, owner: waiver.owner, expiresOn: waiver.expiresOn ?? "" };
  }
  function guideFor(view) {
    const clean = { label: "Show a clean run (S1)", act: "scenario", target: "S1" };
    const total = view.findings.find((finding) => finding.code === "CONTROL_TOTAL_MISMATCH");
    const waiver = waiverInView();
    if (waiver) {
      const until = waiver.expiresOn ? ` until <b>${esc(waiver.expiresOn)}</b>` : "";
      return {
        line: `${esc(waiver.owner)} accepts <b>${esc(waiver.code)}</b>${until}. The verdict is still <b>${esc(view.status)}</b>, and that is the point: a person can accept a gap, never edit the answer.`,
        actions: [{ label: "Check the ledger chain", act: "ledger" }, { label: "Open the register", act: "register" }]
      };
    }
    const chosen = state.picked && state.selected >= 0 ? view.findings[state.selected] : void 0;
    if (chosen) {
      const span = chosen.evidence.span;
      const where = span ? `bytes ${span.start} to ${span.start + span.length - 1} of ${chosen.evidence.side} record ${chosen.recordIndex}` : `${chosen.evidence.side} record ${chosen.recordIndex}`;
      return {
        line: `Finding ${state.selected + 1} of ${view.findings.length}: <b>${esc(chosen.code)}</b>, ${where}. The bytes are lit in column three. A person decides below, with an owner and an expiry; the verdict never moves.`,
        actions: [{ label: "Go to the register", act: "register" }, clean]
      };
    }
    if (view.status === "INCOMPLETE") {
      return {
        line: "I will not guess at a byte nobody wrote down, so nobody gets a PASS today. Read the parse issue, fix the copybook, run it again.",
        actions: [{ label: "Read the parse issues", act: "issues" }, clean]
      };
    }
    if (view.status === "PASS") {
      return view.files.bank ? {
        line: "Agreed to the cent, on both sides. Forty years of silence, and the numbers still behave. Now break it on purpose.",
        actions: [
          { label: "Break it on purpose (S3)", act: "scenario", target: "S3" },
          { label: "Let the bank disagree (S4)", act: "scenario", target: "S4" }
        ]
      } : {
        line: "One side of the story only. Drop the bank file in the top box to turn this into a verdict about agreement.",
        actions: [clean]
      };
    }
    if (total?.declared && total.computed) {
      const span = total.evidence.span;
      const where = span ? `bytes ${span.start} to ${span.start + span.length - 1} of ${total.evidence.side} record ${total.recordIndex}` : `${total.evidence.side} record ${total.recordIndex}`;
      return {
        line: `I kept both numbers for forty years and never subtracted one from the other. Open the total finding: the amount sits at ${where}.`,
        actions: [{ label: "Open the total finding", act: "finding", target: String(total.index) }, clean]
      };
    }
    return {
      line: `${view.findings.length} things the ghost got wrong. Open the first one, or watch it behave on a clean file.`,
      actions: [{ label: "Open the first finding", act: "finding" }, clean]
    };
  }
  function renderGuide(view) {
    const guide = guideFor(view);
    el("guideLine").innerHTML = guide.line;
    el("guideActions").innerHTML = guide.actions.map(
      (action, index) => `<button type="button" class="${index === 0 ? "" : "ghost"}" data-act="${action.act}"${action.target ? ` data-target="${action.target}"` : ""}>${esc(action.label)}</button>`
    ).join("");
  }
  function renderRecords() {
    const view = state.run?.view;
    if (!view) return;
    el("records").innerHTML = view.records.map(
      (record) => `<li class="${record.issues.length ? "issue" : record.isTrailer ? "trailer" : ""}${state.spotlight && state.spotlight.side === record.side && state.spotlight.index === record.index ? " on" : ""}" data-side="${record.side}" data-index="${record.index}">${record.side[0]}${String(record.index).padStart(3, "0")}  ${esc(record.raw)}</li>`
    ).join("");
  }
  function renderVerdict() {
    const view = state.run?.view;
    if (!view) return;
    el("fp").textContent = `fingerprint ${view.fingerprint.slice(0, 16)}...`;
    const status = el("status");
    status.textContent = view.status;
    status.className = `chip ${view.status === "PASS" ? "pass" : view.status === "INCOMPLETE" ? "warn" : "fail"}`;
    const heroChip = el("heroChip");
    heroChip.textContent = view.status;
    heroChip.className = `chip ${view.status === "PASS" ? "pass" : view.status === "INCOMPLETE" ? "warn" : "fail"}`;
    const bankLabel = view.files.bank ? ` against the bank side (${view.files.bank.path})` : "";
    el("heroLine").textContent = `${view.status}, ${view.findings.length} finding${view.findings.length === 1 ? "" : "s"}, ${view.files.payment.details} records from ${view.files.payment.path}${bankLabel}, fingerprint ${view.fingerprint.slice(0, 16)}...`;
    el("heroPlain").innerHTML = plainVerdict(view);
    renderGuide(view);
    el("verdictMeta").textContent = `${view.files.payment.details} details, ${view.files.payment.format}` + (view.files.bank ? ` + bank ${view.files.bank.details} details (${view.files.bank.format})` : "") + (view.summary.blockingParseIssues ? `, ${view.summary.blockingParseIssues} blocking parse issue(s)` : "") + `, ${view.files.payment.path}`;
    el("cDet").textContent = String(view.files.payment.details);
    el("cFind").textContent = String(view.findings.length);
    el("cMatched").textContent = String(view.summary.referencesMatched);
    const c = classification();
    el("cOpen").textContent = c ? String(c.counts.OPEN + c.counts.EXPIRED) : "-";
    el("totals").querySelector("tbody").innerHTML = view.totals.length ? view.totals.map((total) => {
      const basis = total.basis ? `<div class="small muted">${esc(total.basis)}${total.credits || total.debits ? `, credits ${esc(total.credits ?? "0")} / debits ${esc(total.debits ?? "0")}` : ""}</div>` : "";
      return `<tr><td>${esc(total.currency)}${basis}</td><td>${esc(total.declared)}</td><td>${esc(total.computed)}</td><td class="${total.delta.startsWith("-") ? "neg" : ""}">${esc(total.delta)}</td></tr>`;
    }).join("") : '<tr><td colspan="4" class="muted">no declared total</td></tr>';
    el("findings").innerHTML = view.findings.map(
      (finding, index) => `<li data-i="${index}" class="${index === state.selected ? "sel" : ""}">
          <div class="code"><span class="chip fail">${esc(finding.code)}</span> record ${esc(finding.recordIndex)}${finding.field ? `, ${esc(finding.field)}` : ""}</div>
          ${finding.reference ? `<div class="meta">ref ${esc(finding.reference)}</div>` : ""}
          <div class="amt">declared ${esc(finding.declared ?? "-")}; computed ${esc(finding.computed ?? "-")}; delta ${esc(finding.delta ?? "-")}</div>
        </li>`
    ).join("");
    el("findings").style.display = view.findings.length ? "block" : "none";
    el("noFindings").style.display = view.findings.length ? "none" : "block";
    el("issues").innerHTML = view.issues.map(
      (issue) => `<li>${esc(issue.side)}, ${esc(issue.code)}${issue.recordIndex !== void 0 ? ` @record ${esc(issue.recordIndex)}` : ""}: ${esc(issue.detail)}</li>`
    ).join("");
  }
  function renderLedger() {
    const c = classification();
    const integrity = verifyLedger(state.ledger);
    el("l4table").querySelector("tbody").innerHTML = c ? c.entries.map((entry) => {
      const waiver = state.ledger.entries.find((candidate) => candidate.id === entry.waiverId);
      return `<tr><td><span class="st ${entry.status}">${entry.status}</span></td>
            <td>${esc(entry.code)}<div class="small muted">record ${esc(entry.recordIndex)}${entry.expiresOn ? `; expires ${esc(entry.expiresOn)}` : ""}</div></td>
            <td>${waiver ? `${esc(waiver.owner)}<div class="small muted">${esc(waiver.reason)}</div>` : '<span class="muted">-</span>'}</td></tr>`;
    }).join("") : '<tr><td colspan="3" class="muted">run a scenario to see the register</td></tr>';
    el("chain").textContent = state.ledger.entries.length ? `${state.ledger.entries.length} entr${state.ledger.entries.length === 1 ? "y" : "ies"}; chain ${integrity.ok ? "intact" : `BROKEN at seq ${integrity.firstInvalidSeq}`}; head ${state.ledger.entries[state.ledger.entries.length - 1].hash.slice(0, 16)}...` : "ledger empty: the chain starts when a person waives the first finding";
  }
  function firstDetail(side) {
    const view = state.run?.view;
    if (!view) return 0;
    const record = view.records.find((entry) => entry.side === side && !entry.isTrailer);
    return record ? record.index : 0;
  }
  function renderEvidence() {
    const view = state.run?.view;
    if (!view) return;
    const finding = state.selected >= 0 ? view.findings[state.selected] : void 0;
    if (!finding) {
      const spot = state.spotlight ?? { side: "payment", index: firstDetail("payment") };
      const record2 = view.records.find((entry) => entry.side === spot.side && entry.index === spot.index);
      el("evidenceNote").textContent = record2 ? `${record2.side} record ${record2.index} sliced by its own spec: every field at the declared byte offset${record2.isTrailer ? " (control trailer)" : ""}.` : "Pick a record below to read its layout.";
      if (!record2) return;
      el("bytes").innerHTML = [...record2.raw].map((char, index) => `<span class="byte" title="byte ${index + 1}">${char === " " ? "." : esc(char)}</span>`).join("");
      el("ruler").textContent = ruler(record2.raw.length);
      el("fieldmeta").innerHTML = `<table class="legend"><tr><th>field</th><th>pic</th><th>bytes</th><th>as read</th></tr>${record2.fields.map(
        (field, index) => `<tr><td><span class="sw f${index % 6}"></span><span class="nm">${esc(field.name)}</span></td><td class="nm">${esc(field.pic)}</td><td class="nm">${field.start}-${field.start + field.length - 1}</td><td class="pv">${esc(JSON.stringify(field.text))}</td></tr>`
      ).join("")}</table>`;
      el("explain").innerHTML = '<div class="muted small">L3 narrates a finding. Select one in the verdict column.</div>';
      return;
    }
    const evidence = finding.evidence;
    const record = view.records.find((entry) => entry.side === evidence.side && entry.index === evidence.recordIndex);
    el("evidenceNote").textContent = `${evidence.note}, ${evidence.side} file`;
    if (record) {
      el("bytes").innerHTML = [...record.raw].map((char, index) => {
        const inSpan = evidence.span && index >= evidence.span.start - 1 && index < evidence.span.start - 1 + evidence.span.length;
        return `<span class="byte${inSpan ? " hl" : ""}" title="byte ${index + 1}">${char === " " ? "." : esc(char)}</span>`;
      }).join("");
      el("ruler").textContent = ruler(record.raw.length);
    }
    const rows = [`<dt>record</dt><dd>${esc(evidence.side)} #${esc(evidence.recordIndex)}</dd>`];
    if (evidence.field) rows.push(`<dt>field</dt><dd>${esc(evidence.field)}${evidence.pic ? `, ${esc(evidence.pic)}` : ""}</dd>`);
    if (evidence.span) rows.push(`<dt>bytes</dt><dd>${evidence.span.start}-${evidence.span.start + evidence.span.length - 1} (${evidence.span.length} bytes)</dd>`);
    if (evidence.fieldText !== void 0) rows.push(`<dt>as read</dt><dd>${esc(JSON.stringify(evidence.fieldText))}</dd>`);
    if (finding.declared !== void 0) rows.push(`<dt>declared</dt><dd>${esc(finding.declared)}</dd>`);
    if (finding.computed !== void 0) rows.push(`<dt>computed</dt><dd>${esc(finding.computed)}</dd>`);
    if (finding.delta !== void 0) rows.push(`<dt>delta</dt><dd>${esc(finding.delta)}</dd>`);
    el("fieldmeta").innerHTML = `<dl class="fieldmeta">${rows.join("")}</dl>`;
    const explanation = finding.explanation;
    if (!explanation) {
      el("explain").innerHTML = '<div class="muted small">No explanation was produced for this finding.</div>';
      return;
    }
    const blocked = explanation.status !== "EXPLAINED";
    el("explain").innerHTML = `<div class="explain ${blocked ? "blocked" : ""}">
    <div class="row" style="gap:8px;align-items:center">
      <span class="chip ${blocked ? "warn" : "info"}">${esc(explanation.status)}</span>
      <span class="small muted">L3: ${esc(explanation.adapter)}; cites ${esc((explanation.citedValues ?? []).length)} value(s)</span>
    </div>
    <div class="cause">${esc(explanation.cause)}</div>
    <div class="fix">${esc(explanation.suggestedFix)}</div>
    <div class="cited">${(explanation.citedValues ?? []).map((value) => `<span>${esc(value)}</span>`).join("")}</div>
    <div class="small muted" style="margin-top:6px">citation ${esc(explanation.citation)}</div>
  </div>`;
  }
  function ruler(length) {
    let out = "";
    for (let position = 0; position < length; position += 10) {
      out += String(position + 1).padEnd(10, " ");
    }
    return out;
  }
  function render2() {
    renderScenarios();
    renderRecords();
    renderVerdict();
    renderEvidence();
    renderLedger();
  }
  function selectedFinding() {
    return state.run && state.selected >= 0 ? state.run.findings[state.selected] ?? null : null;
  }
  function checkLedger() {
    const entries = state.ledger.entries.length;
    if (entries === 0) {
      toast("the ledger is empty: no human has decided anything yet. Waive a finding to start the chain");
      return;
    }
    const integrity = verifyLedger(state.ledger);
    toast(
      integrity.ok ? `chain intact: ${entries} decision${entries === 1 ? "" : "s"}, nothing edited behind your back` : `chain BROKEN at sequence ${integrity.firstInvalidSeq}: someone edited a decision after the fact`
    );
  }
  function renderVerify(identical, note) {
    el("verifyOut").innerHTML = identical ? `<span style="color:#79d492">identical: same inputs, same verdict</span><br/>${esc(note)}` : `<span style="color:#ff9c94">DIFFERENT: ${esc(note)}</span>`;
  }
  function wire() {
    wireStrip("strip-top");
    wireStrip("strip-bottom");
    wireStrip("strip-kiro");
    el("scenarios").addEventListener("click", (event) => {
      const button = event.target.closest(".scenario");
      if (!button) return;
      void runScenario(button.dataset.id);
    });
    el("findings").addEventListener("click", (event) => {
      const item = event.target.closest("li[data-i]");
      if (!item) return;
      state.selected = Number(item.dataset.i);
      state.picked = true;
      render2();
    });
    el("guideActions").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-act]");
      if (!button) return;
      const act = button.dataset.act;
      if (act === "scenario" && button.dataset.target) {
        void runScenario(button.dataset.target).catch((error) => toast(error.message));
        return;
      }
      if (act === "finding") {
        const run = state.run;
        if (!run || run.findings.length === 0) {
          toast("this run has no findings to open: every control total, reference and value date agrees");
          return;
        }
        const index = Number(button.dataset.target ?? "0");
        state.selected = Number.isInteger(index) && index >= 0 && index < run.findings.length ? index : 0;
        state.picked = true;
        render2();
        if (window.innerWidth < 1080) {
          document.getElementById("findings")?.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        return;
      }
      if (act === "issues") {
        document.getElementById("issues")?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (act === "register") {
        document.getElementById("l4table")?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (act === "ledger") checkLedger();
    });
    el("records").addEventListener("click", (event) => {
      const item = event.target.closest("li[data-index]");
      state.selected = -1;
      if (item) {
        state.spotlight = { side: item.dataset.side, index: Number(item.dataset.index) };
      }
      render2();
    });
    el("btnVerify").addEventListener("click", () => {
      const run = state.run;
      if (!run) return;
      void (async () => {
        const before = run.fingerprint;
        const scenario = SCENARIOS.find((entry) => entry.id === run.scenarioId);
        if (!scenario) {
          await runDropped();
          const afterDropped = state.run.fingerprint;
          renderVerify(before === afterDropped, `dropped file, recorded ${before.slice(0, 16)}..., recomputed ${afterDropped.slice(0, 16)}...`);
          return;
        }
        await runScenario(scenario.id);
        const after = state.run.fingerprint;
        renderVerify(before === after, `recorded ${before.slice(0, 16)}..., recomputed ${after.slice(0, 16)}...`);
      })();
    });
    el("btnWaive").addEventListener("click", () => {
      const finding = selectedFinding();
      if (!finding) {
        toast("pick a finding in the verdict column first, then waive it");
        return;
      }
      const owner = el("l4owner").value.trim();
      const reason = el("l4reason").value.trim();
      const control = el("l4control").value.trim();
      const expires = el("l4expires").value.trim();
      if (!expires) {
        toast("a waiver without an expiry is a ghost story that never ends: add a date in expires YYYY-MM-DD");
        return;
      }
      try {
        state.ledger = appendWaiver(
          state.ledger,
          { owner, reason, compensatingControl: control, expiresOn: expires, decidedOn: TODAY },
          finding,
          { fingerprint: state.run.fingerprint, decidedOn: TODAY }
        );
        persist();
        render2();
        toast(`waived ${finding.code}. The verdict above still says FAIL: a person can accept a gap, not edit the answer`);
      } catch (error) {
        toast(error.message);
      }
    });
    el("btnRelease").addEventListener("click", () => {
      const finding = selectedFinding();
      if (!finding) return;
      const c = classification();
      const entry = c?.entries.find((candidate) => candidate.code === finding.code && candidate.recordIndex === finding.recordIndex);
      if (!entry?.waiverId) {
        toast("there is no waiver on this finding, so nothing to release: waive it first, then release it");
        return;
      }
      try {
        state.ledger = appendRelease(
          state.ledger,
          {
            owner: el("l4owner").value.trim() || "demo operator",
            reason: el("l4reason").value.trim() || "exception withdrawn in the demo",
            control: el("l4control").value.trim() || "waiver withdrawn",
            decidedOn: TODAY
          },
          entry.waiverId
        );
        persist();
        render2();
        toast("released: the finding is open again, and the ghost keeps the receipt");
      } catch (error) {
        toast(error.message);
      }
    });
    el("btnLedger").addEventListener("click", () => checkLedger());
    el("btnDownload").addEventListener("click", () => {
      const blob = new Blob([serialiseLedger(state.ledger)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "ledger.json";
      link.click();
      URL.revokeObjectURL(link.href);
    });
    el("btnDrop").addEventListener("click", () => {
      void (async () => {
        try {
          await runDropped();
        } catch (error) {
          toast(`the ghost refused that file: ${error.message}. Check the copybook first, then select fixed-width or BAI2 and run again`);
        }
      })();
    });
    for (const [zone, key] of [["dropFile", "droppedFile"], ["dropCopybook", "droppedCopybook"]]) {
      const node = el(zone);
      const accept = (file) => {
        if (!file) return;
        void file.arrayBuffer().then((buffer) => {
          state[key] = { name: file.name, bytes: new Uint8Array(buffer) };
          el("dropped").textContent = `${state.droppedFile ? `file: ${state.droppedFile.name} (${state.droppedFile.bytes.length} bytes)` : ""}${state.droppedCopybook ? `, copybook: ${state.droppedCopybook.name}` : ""}`;
        });
      };
      node.addEventListener("dragover", (event) => {
        event.preventDefault();
        node.classList.add("over");
      });
      node.addEventListener("dragleave", () => node.classList.remove("over"));
      node.addEventListener("drop", (event) => {
        event.preventDefault();
        node.classList.remove("over");
        accept(event.dataTransfer?.files[0]);
      });
      node.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = key === "droppedCopybook" ? ".cpy,.cbl,.txt" : ".txt,.dat,.bai";
        input.onchange = () => accept(input.files?.[0]);
        input.click();
      });
    }
  }
  function persist() {
    try {
      window.localStorage.setItem(LEDGER_KEY, serialiseLedger(state.ledger));
    } catch {
    }
  }
  function restore() {
    try {
      const text = window.localStorage.getItem(LEDGER_KEY);
      if (text) state.ledger = parseLedger(text);
    } catch {
      state.ledger = emptyLedger();
    }
  }
  function stripHtml(tag, brief, items) {
    return `<span class="tag">${tag}</span><span class="item brief">${esc(brief)}</span><button type="button" class="strip-toggle" aria-expanded="false">Show all (${items.length})</button><div class="strip-items">${items.map((item) => `<span class="item">${esc(item)}</span>`).join("")}</div>`;
  }
  function stripGuarantees() {
    el("strip-top").innerHTML = stripHtml(
      "Guaranteed",
      "6 checks: format, layout, arithmetic, references, replay, grounding",
      GUARANTEES.guaranteed
    );
    el("strip-bottom").innerHTML = stripHtml(
      "Not guaranteed: a human decides",
      "6 limits: legal adequacy, exception sign-off, unmodelled clauses, source authenticity, ANSI X12 transaction sets, tamper proof history",
      GUARANTEES.notGuaranteed
    );
  }
  function wireStrip(id) {
    const node = el(id);
    node.addEventListener("click", (event) => {
      const button = event.target.closest(".strip-toggle");
      if (!button) return;
      const open = node.classList.toggle("open");
      button.setAttribute("aria-expanded", String(open));
      button.textContent = open ? "Hide" : `Show all (${node.querySelectorAll(".strip-items .item").length})`;
    });
  }
  function boot() {
    wire();
    stripGuarantees();
    restore();
    renderScenarios();
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("scenario");
    const id = requested && SCENARIOS.some((entry) => entry.id === requested) ? requested : "S3";
    void runScenario(id).catch((error) => toast(error.message));
  }
  boot();
  window.demo = {
    state,
    SCENARIOS,
    today: TODAY,
    /** Run a scenario and resolve when the view is on screen. */
    async run(id) {
      await runScenario(id);
      return state.run?.fingerprint ?? null;
    },
    classification,
    verifyLedger
  };
})();
