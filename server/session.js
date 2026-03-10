function createSessionManager({ metadata, quranDataset, duasById, eventsById }) {
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

  function listEvents() {
    return [...eventsById.values()]
      .map((event) => ({
        id: event.id,
        title: event.title,
        totalSections: event.sections.length
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  function getDefaultDuaId() {
    if (duasById.has('iftitah')) {
      return 'iftitah';
    }
    return listDuas()[0]?.id || '';
  }

  function getDefaultEventId() {
    if (eventsById.has('laylat-al-qadr-21')) {
      return 'laylat-al-qadr-21';
    }
    return listEvents()[0]?.id || '';
  }

  function getModeLabel(sessionType) {
    if (sessionType === 'dua') {
      return 'Dua';
    }
    if (sessionType === 'guided_event') {
      return 'Guided Event';
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

  function clampGuidedEventState(candidateGuidedEvent, selectedEventId) {
    const defaultId = getDefaultEventId();
    const eventId = String(selectedEventId || defaultId)
      .trim()
      .toLowerCase();
    const event = eventsById.get(eventId) || eventsById.get(defaultId);

    if (!event) {
      return {
        sectionIndex: 0,
        slideIndex: 0
      };
    }

    const sectionIndex = Math.max(
      0,
      Math.min(event.sections.length - 1, Number(candidateGuidedEvent?.sectionIndex) || 0)
    );
    const section = event.sections[sectionIndex];
    const slideIndex = Math.max(
      0,
      Math.min(section.slides.length - 1, Number(candidateGuidedEvent?.slideIndex) || 0)
    );

    return {
      sectionIndex,
      slideIndex
    };
  }

  function clampSessionType(value) {
    if (value === 'dua' || value === 'guided_event') {
      return value;
    }
    return 'quran';
  }

  function clampState(candidateState) {
    const sessionType = clampSessionType(candidateState?.sessionType);
    const selectedDuaId = sessionType === 'dua' ? getDefaultDuaId() : null;
    const selectedEventId = sessionType === 'guided_event' ? getDefaultEventId() : null;

    const requestedDuaId = sessionType === 'dua'
      ? String(candidateState?.selectedDuaId || selectedDuaId || '')
          .trim()
          .toLowerCase()
      : null;
    const requestedEventId = sessionType === 'guided_event'
      ? String(candidateState?.selectedEventId || selectedEventId || '')
          .trim()
          .toLowerCase()
      : null;

    return {
      sessionType,
      selectedDuaId: sessionType === 'dua' ? (duasById.has(requestedDuaId) ? requestedDuaId : selectedDuaId) : null,
      selectedEventId:
        sessionType === 'guided_event'
          ? eventsById.has(requestedEventId)
            ? requestedEventId
            : selectedEventId
          : null,
      quran: clampQuranState(
        candidateState?.quran?.surahNumber,
        candidateState?.quran?.ayahNumber
      ),
      dua: clampDuaState(candidateState?.dua, requestedDuaId || selectedDuaId),
      guidedEvent: clampGuidedEventState(
        candidateState?.guidedEvent,
        requestedEventId || selectedEventId
      )
    };
  }

  function createNewSession(sessionType, options = {}) {
    return clampState({
      sessionType,
      selectedDuaId: options.selectedDuaId || null,
      selectedEventId: options.selectedEventId || null,
      quran: { surahNumber: 1, ayahNumber: 1 },
      dua: { lineIndex: 1 },
      guidedEvent: { sectionIndex: 0, slideIndex: 0 }
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

  function getGuidedEventContentPayload(state) {
    const event = eventsById.get(state.selectedEventId || '');
    if (!event) {
      return {
        mode: 'guided_event',
        modeLabel: 'Guided Event Mode',
        header: 'Guided Event',
        title: 'Event unavailable',
        instruction: 'Add a valid JSON file in data/events.',
        repeat: '',
        reference: '',
        arabic: '',
        transliteration: '',
        english: '',
        note: 'Selected guided event could not be loaded.',
        guidedEvent: {
          eventId: '',
          eventTitle: 'Guided Event',
          sectionIndex: 0,
          sectionTitle: 'Section 1',
          totalSections: 1,
          slideIndex: 0,
          totalSlides: 1,
          sections: []
        }
      };
    }

    const guidedEvent = clampGuidedEventState(state.guidedEvent, event.id);
    const section = event.sections[guidedEvent.sectionIndex];
    const slide = section.slides[guidedEvent.slideIndex] || {};

    return {
      mode: 'guided_event',
      modeLabel: 'Guided Event Mode',
      header: `${event.title} · ${section.title} · Slide ${guidedEvent.slideIndex + 1}`,
      title: slide.title || section.title,
      instruction: slide.instruction || '',
      repeat: slide.repeat || '',
      reference: slide.reference || '',
      arabic: slide.arabic || '',
      transliteration: slide.transliteration || '',
      english: slide.english || '',
      note: slide.note || '',
      guidedEvent: {
        eventId: event.id,
        eventTitle: event.title,
        sectionIndex: guidedEvent.sectionIndex,
        sectionTitle: section.title,
        totalSections: event.sections.length,
        slideIndex: guidedEvent.slideIndex,
        totalSlides: section.slides.length,
        sections: event.sections.map((entry, index) => ({
          index,
          id: entry.id,
          title: entry.title,
          totalSlides: entry.slides.length
        }))
      }
    };
  }

  function getCurrentContentPayload(state) {
    if (state.sessionType === 'dua') {
      return getDuaContentPayload(state);
    }

    if (state.sessionType === 'guided_event') {
      return getGuidedEventContentPayload(state);
    }

    return getQuranContentPayload(state);
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

    if (state.sessionType === 'guided_event') {
      const event = eventsById.get(state.selectedEventId || '');
      const section = event?.sections[state.guidedEvent.sectionIndex];
      return `${event?.title || 'Guided Event'} · ${section?.title || 'Section'} · Slide ${state.guidedEvent.slideIndex + 1}`;
    }

    return describeQuranTarget(state.quran);
  }

  function summarizeSession(state) {
    return `${getModeLabel(state.sessionType)} — ${describeSelectedContent(state)}`;
  }

  function statesEqual(a, b) {
    return (
      a.sessionType === b.sessionType &&
      a.selectedDuaId === b.selectedDuaId &&
      a.selectedEventId === b.selectedEventId &&
      a.quran.surahNumber === b.quran.surahNumber &&
      a.quran.ayahNumber === b.quran.ayahNumber &&
      a.dua.lineIndex === b.dua.lineIndex &&
      a.guidedEvent.sectionIndex === b.guidedEvent.sectionIndex &&
      a.guidedEvent.slideIndex === b.guidedEvent.slideIndex
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

  function stepGuidedEvent(state, direction) {
    const event = eventsById.get(state.selectedEventId || '');
    if (!event) {
      return state.guidedEvent;
    }

    let sectionIndex = state.guidedEvent.sectionIndex;
    let slideIndex = state.guidedEvent.slideIndex;

    if (direction === 'prev') {
      if (slideIndex > 0) {
        slideIndex -= 1;
      } else if (sectionIndex > 0) {
        sectionIndex -= 1;
        slideIndex = event.sections[sectionIndex].slides.length - 1;
      }
    } else if (direction === 'next') {
      if (slideIndex < event.sections[sectionIndex].slides.length - 1) {
        slideIndex += 1;
      } else if (sectionIndex < event.sections.length - 1) {
        sectionIndex += 1;
        slideIndex = 0;
      }
    }

    return clampGuidedEventState({ sectionIndex, slideIndex }, event.id);
  }

  function transition(state, action) {
    const currentState = clampState(state);

    if (currentState.sessionType === 'quran') {
      if (action.type === 'select_surah') {
        const nextQuran = clampQuranState(action.surahNumber, 1);
        const nextState = clampState({
          ...currentState,
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

    if (currentState.sessionType === 'guided_event') {
      const event = eventsById.get(currentState.selectedEventId || '');
      if (action.type === 'jump_section') {
        const nextGuidedEvent = clampGuidedEventState(
          {
            sectionIndex: action.sectionIndex,
            slideIndex: 0
          },
          currentState.selectedEventId
        );
        const nextState = clampState({
          ...currentState,
          guidedEvent: nextGuidedEvent
        });
        const section = event?.sections[nextGuidedEvent.sectionIndex];

        return {
          state: nextState,
          changed: !statesEqual(currentState, nextState),
          activity: {
            action: 'JUMP',
            detail: `Section ${nextGuidedEvent.sectionIndex + 1} "${section?.title || 'Section'}" → Slide 1`
          }
        };
      }

      if (action.type === 'step') {
        const nextGuidedEvent = stepGuidedEvent(currentState, action.direction);
        const nextState = clampState({
          ...currentState,
          guidedEvent: nextGuidedEvent
        });
        const section = event?.sections[nextGuidedEvent.sectionIndex];

        return {
          state: nextState,
          changed: !statesEqual(currentState, nextState),
          activity: {
            action: action.direction === 'prev' ? 'PREVIOUS' : 'NEXT',
            detail: `Section ${nextGuidedEvent.sectionIndex + 1} "${section?.title || 'Section'}" → Slide ${nextGuidedEvent.slideIndex + 1}`
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
      selectedDuaId: state.selectedDuaId,
      selectedEventId: state.selectedEventId,
      quran: state.quran,
      dua: state.dua,
      guidedEvent: state.guidedEvent,
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

    if (state.sessionType === 'guided_event') {
      const event = eventsById.get(state.selectedEventId || '');
      payload.lockedEvent = event
        ? {
            id: event.id,
            title: event.title,
            sections: event.sections.map((section, index) => ({
              index,
              id: section.id,
              title: section.title,
              totalSlides: section.slides.length
            }))
          }
        : null;
    }

    return payload;
  }

  return {
    clampState,
    createNewSession,
    describeSelectedContent,
    getCurrentContentPayload,
    getDefaultDuaId,
    getDefaultEventId,
    getModeLabel,
    getPublicSessionData,
    listDuas,
    listEvents,
    metadata,
    quranDataset,
    summarizeSession,
    transition
  };
}

module.exports = {
  createSessionManager
};
