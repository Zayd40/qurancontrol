function createSessionManager({ metadata, quranDataset, duasById }) {
  const surahMetaByNumber = new Map();
  for (const surah of metadata.surahs || []) {
    surahMetaByNumber.set(Number(surah.number), {
      number: Number(surah.number) || 1,
      nameEnglish: String(surah.nameEnglish || `Surah ${surah.number || 1}`),
      nameArabic: String(surah.nameArabic || ''),
      ayahCount: Number(surah.ayahCount) || 1
    });
  }

  function listDuas() {
    return [...duasById.values()]
      .map((dua) => ({
        id: dua.id,
        title: dua.title,
        totalLines: dua.lines.length
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  function getDefaultDuaId() {
    if (duasById.has('iftitah')) {
      return 'iftitah';
    }
    return listDuas()[0]?.id || '';
  }

  function getModeLabel(sessionType) {
    if (sessionType === 'dua') {
      return 'Dua';
    }
    return 'Quran';
  }

  function getMaxAyahForSurah(surahNumber) {
    const fromMeta = surahMetaByNumber.get(surahNumber)?.ayahCount;
    if (Number.isFinite(fromMeta) && fromMeta > 0) {
      return fromMeta;
    }

    const ayahMap = quranDataset.ayahDataBySurah.get(surahNumber);
    if (!ayahMap || ayahMap.size === 0) {
      return 1;
    }

    return Math.max(...ayahMap.keys());
  }

  function clampQuranState(nextSurah, nextAyah) {
    const totalSurahs = metadata.surahs?.length || 114;
    const surahNumber = Math.max(1, Math.min(totalSurahs, Number(nextSurah) || 1));
    const maxAyah = getMaxAyahForSurah(surahNumber);
    const ayahNumber = Math.max(1, Math.min(maxAyah, Number(nextAyah) || 1));

    return { surahNumber, ayahNumber };
  }

  function clampDuaState(candidateDua, selectedDuaId) {
    const defaultId = getDefaultDuaId();
    const duaId = String(selectedDuaId || candidateDua?.duaId || defaultId)
      .trim()
      .toLowerCase();
    const dua = duasById.get(duaId) || duasById.get(defaultId);

    if (!dua) {
      return { lineIndex: 1 };
    }

    const maxLine = dua.lines.length || 1;
    return {
      lineIndex: Math.max(1, Math.min(maxLine, Number(candidateDua?.lineIndex) || 1))
    };
  }

  function clampSessionType(value) {
    if (value === 'dua') {
      return value;
    }
    return 'quran';
  }

  function clampState(candidateState) {
    const sessionType = clampSessionType(candidateState?.sessionType);
    const selectedDuaId = sessionType === 'dua' ? getDefaultDuaId() : null;

    const requestedDuaId = sessionType === 'dua'
      ? String(candidateState?.selectedDuaId || selectedDuaId || '')
          .trim()
          .toLowerCase()
      : null;

    return {
      sessionType,
      blanked: Boolean(candidateState?.blanked),
      selectedDuaId: sessionType === 'dua' ? (duasById.has(requestedDuaId) ? requestedDuaId : selectedDuaId) : null,
      quran: clampQuranState(
        candidateState?.quran?.surahNumber,
        candidateState?.quran?.ayahNumber
      ),
      dua: clampDuaState(candidateState?.dua, requestedDuaId || selectedDuaId)
    };
  }

  function createNewSession(sessionType, options = {}) {
    return clampState({
      sessionType,
      blanked: false,
      selectedDuaId: options.selectedDuaId || null,
      quran: { surahNumber: 1, ayahNumber: 1 },
      dua: { lineIndex: 1 }
    });
  }

  function getAyahPayload(surahNumber, ayahNumber) {
    const meta =
      surahMetaByNumber.get(surahNumber) || {
        number: surahNumber,
        nameEnglish: `Surah ${surahNumber}`,
        nameArabic: '',
        ayahCount: getMaxAyahForSurah(surahNumber)
      };

    const ayahMap = quranDataset.ayahDataBySurah.get(surahNumber);
    const ayah = ayahMap?.get(ayahNumber);

    if (ayah) {
      return {
        surahNumber,
        ayahNumber,
        surahNameEnglish: meta.nameEnglish,
        surahNameArabic: meta.nameArabic,
        ayahCount: meta.ayahCount,
        arabic: ayah.arabic,
        english: ayah.translation,
        transliteration: ayah.transliteration,
        missing: false
      };
    }

    return {
      surahNumber,
      ayahNumber,
      surahNameEnglish: meta.nameEnglish,
      surahNameArabic: meta.nameArabic,
      ayahCount: meta.ayahCount,
      arabic: '—',
      english: `No bundled text for Surah ${surahNumber}, Ayah ${ayahNumber}.`,
      transliteration: 'Add a full dataset file at data/quran.full.json or set QURAN_DATA_FILE.',
      missing: true
    };
  }

  function getQuranContentPayload(state) {
    const ayah = getAyahPayload(state.quran.surahNumber, state.quran.ayahNumber);

    return {
      mode: 'quran',
      modeLabel: 'Quran Mode',
      header: `${ayah.surahNameEnglish} (${ayah.surahNumber}) · Ayah ${ayah.ayahNumber}`,
      displayTitle: `${ayah.surahNameEnglish} (${ayah.surahNumber})`,
      lineLabel: `Ayah ${ayah.ayahNumber}`,
      title: '',
      instruction: '',
      repeat: '',
      reference: '',
      arabic: ayah.arabic,
      transliteration: ayah.transliteration,
      english: ayah.english,
      note: ayah.missing ? 'Offline dataset is missing this ayah.' : '',
      quran: ayah
    };
  }

  function getDuaContentPayload(state) {
    const dua = duasById.get(state.selectedDuaId || '');
    if (!dua) {
      return {
        mode: 'dua',
        modeLabel: 'Dua Mode',
        header: 'Dua · Line 1',
        displayTitle: 'Dua unavailable',
        lineLabel: 'Line 1',
        title: 'Dua unavailable',
        instruction: '',
        repeat: '',
        reference: '',
        arabic: '—',
        transliteration: '',
        english: 'Add a valid dua JSON file in data/duas.',
        note: 'Selected dua could not be loaded.',
        dua: {
          duaId: '',
          title: 'Dua unavailable',
          lineIndex: 1,
          totalLines: 1
        }
      };
    }

    const lineIndex = clampDuaState(state.dua, dua.id).lineIndex;
    const line = dua.lines[lineIndex - 1] || { arabic: '—', transliteration: '', english: '' };

    return {
      mode: 'dua',
      modeLabel: 'Dua Mode',
      header: `${dua.title} · Line ${lineIndex}`,
      displayTitle: dua.title,
      lineLabel: `Line ${lineIndex}`,
      title: '',
      instruction: '',
      repeat: '',
      reference: '',
      arabic: line.arabic || '—',
      transliteration: line.transliteration || '',
      english: line.english || '',
      note: '',
      dua: {
        duaId: dua.id,
        title: dua.title,
        lineIndex,
        totalLines: dua.lines.length
      }
    };
  }

  function getCurrentContentPayload(state) {
    const currentState = clampState(state);
    let payload;

    if (currentState.sessionType === 'dua') {
      payload = getDuaContentPayload(currentState);
    } else {
      payload = getQuranContentPayload(currentState);
    }

    return {
      ...payload,
      blanked: currentState.blanked
    };
  }

  function describeQuranTarget(quranState) {
    const meta = surahMetaByNumber.get(quranState.surahNumber);
    const surahName = meta?.nameEnglish || `Surah ${quranState.surahNumber}`;
    return `Surah ${quranState.surahNumber} ${surahName} · Ayah ${quranState.ayahNumber}`;
  }

  function describeSelectedContent(state) {
    if (state.sessionType === 'dua') {
      const dua = duasById.get(state.selectedDuaId || '');
      const title = dua?.title || 'Dua';
      return `${title} · Line ${state.dua.lineIndex}`;
    }

    return describeQuranTarget(state.quran);
  }

  function summarizeSession(state) {
    return `${getModeLabel(state.sessionType)} — ${describeSelectedContent(state)}`;
  }

  function statesEqual(a, b) {
    return (
      a.sessionType === b.sessionType &&
      a.blanked === b.blanked &&
      a.selectedDuaId === b.selectedDuaId &&
      a.quran.surahNumber === b.quran.surahNumber &&
      a.quran.ayahNumber === b.quran.ayahNumber &&
      a.dua.lineIndex === b.dua.lineIndex
    );
  }

  function stepQuran(quranState, direction) {
    const step = direction === 'prev' ? -1 : 1;
    const totalSurahs = metadata.surahs?.length || 114;

    let surahNumber = quranState.surahNumber;
    let ayahNumber = quranState.ayahNumber + step;

    const maxAyah = getMaxAyahForSurah(surahNumber);
    if (ayahNumber > maxAyah) {
      if (surahNumber < totalSurahs) {
        surahNumber += 1;
        ayahNumber = 1;
      } else {
        ayahNumber = maxAyah;
      }
    }

    if (ayahNumber < 1) {
      if (surahNumber > 1) {
        surahNumber -= 1;
        ayahNumber = getMaxAyahForSurah(surahNumber);
      } else {
        ayahNumber = 1;
      }
    }

    return clampQuranState(surahNumber, ayahNumber);
  }

  function stepDua(state, direction) {
    const step = direction === 'prev' ? -1 : 1;
    const dua = duasById.get(state.selectedDuaId || '');
    const totalLines = dua?.lines.length || 1;
    return {
      lineIndex: Math.max(1, Math.min(totalLines, state.dua.lineIndex + step))
    };
  }

  function transition(state, action) {
    const currentState = clampState(state);

    if (currentState.sessionType === 'quran') {
      if (action.type === 'select_surah') {
        const nextQuran = clampQuranState(action.surahNumber, 1);
        const nextState = clampState({
          ...currentState,
          blanked: false,
          quran: nextQuran
        });

        return {
          state: nextState,
          changed: !statesEqual(currentState, nextState),
          activity: {
            action: 'SURAH CHANGE',
            detail: `Surah ${nextQuran.surahNumber} ${surahMetaByNumber.get(nextQuran.surahNumber)?.nameEnglish || ''}`.trim()
          }
        };
      }

      if (action.type === 'jump_ayah') {
        const nextQuran = clampQuranState(currentState.quran.surahNumber, action.ayahNumber);
        const nextState = clampState({
          ...currentState,
          blanked: false,
          quran: nextQuran
        });

        return {
          state: nextState,
          changed: !statesEqual(currentState, nextState),
          activity: {
            action: 'JUMP',
            detail: `Surah ${nextQuran.surahNumber} → Ayah ${nextQuran.ayahNumber}`
          }
        };
      }

      if (action.type === 'step') {
        const nextQuran = stepQuran(currentState.quran, action.direction);
        const nextState = clampState({
          ...currentState,
          blanked: false,
          quran: nextQuran
        });

        return {
          state: nextState,
          changed: !statesEqual(currentState, nextState),
          activity: {
            action: action.direction === 'prev' ? 'PREVIOUS' : 'NEXT',
            detail: `Surah ${nextQuran.surahNumber} → Ayah ${nextQuran.ayahNumber}`
          }
        };
      }
    }

    if (currentState.sessionType === 'dua') {
      if (action.type === 'jump_line') {
        const nextDua = clampDuaState({ lineIndex: action.lineIndex }, currentState.selectedDuaId);
        const nextState = clampState({
          ...currentState,
          blanked: false,
          dua: nextDua
        });
        const dua = duasById.get(currentState.selectedDuaId || '');

        return {
          state: nextState,
          changed: !statesEqual(currentState, nextState),
          activity: {
            action: 'JUMP',
            detail: `${dua?.title || 'Dua'} → Line ${nextDua.lineIndex}`
          }
        };
      }

      if (action.type === 'step') {
        const nextDua = stepDua(currentState, action.direction);
        const nextState = clampState({
          ...currentState,
          blanked: false,
          dua: nextDua
        });
        const dua = duasById.get(currentState.selectedDuaId || '');

        return {
          state: nextState,
          changed: !statesEqual(currentState, nextState),
          activity: {
            action: action.direction === 'prev' ? 'PREVIOUS' : 'NEXT',
            detail: `${dua?.title || 'Dua'} → Line ${nextDua.lineIndex}`
          }
        };
      }
    }

    return {
      state: currentState,
      changed: false,
      activity: null
    };
  }

  function getPublicSessionData(state) {
    const payload = {
      sessionType: state.sessionType,
      modeLabel: getModeLabel(state.sessionType),
      blanked: state.blanked,
      selectedDuaId: state.selectedDuaId,
      quran: state.quran,
      dua: state.dua,
      selectedContent: describeSelectedContent(state)
    };

    if (state.sessionType === 'dua') {
      const dua = duasById.get(state.selectedDuaId || '');
      payload.lockedDua = dua
        ? {
            id: dua.id,
            title: dua.title,
            totalLines: dua.lines.length
          }
        : null;
    }

    return payload;
  }

  function restartSession(state) {
    const currentState = clampState(state);

    if (currentState.sessionType === 'dua') {
      return createNewSession('dua', {
        selectedDuaId: currentState.selectedDuaId || getDefaultDuaId()
      });
    }

    return createNewSession('quran');
  }

  function resetToFirstPosition(state) {
    const currentState = clampState(state);

    if (currentState.sessionType === 'dua') {
      return clampState({
        ...currentState,
        blanked: false,
        dua: {
          lineIndex: 1
        }
      });
    }

    return clampState({
      ...currentState,
      blanked: false,
      quran: {
        surahNumber: currentState.quran.surahNumber,
        ayahNumber: 1
      }
    });
  }

  function setBlanked(state, blanked) {
    return clampState({
      ...state,
      blanked: Boolean(blanked)
    });
  }

  return {
    clampState,
    createNewSession,
    describeSelectedContent,
    getCurrentContentPayload,
    getDefaultDuaId,
    getModeLabel,
    getPublicSessionData,
    listDuas,
    metadata,
    quranDataset,
    resetToFirstPosition,
    restartSession,
    setBlanked,
    summarizeSession,
    transition
  };
}

module.exports = {
  createSessionManager
};
