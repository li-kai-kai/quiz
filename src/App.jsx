import { useEffect, useMemo, useState } from 'react'
import './App.css'

const PROGRESS_KEY = 'softexam-progress-v1'

function normalizeQuestions(raw) {
  return raw
    .filter((q) => q.stem && q.options && Object.keys(q.options).length > 1 && q.answer)
    .map((q, i) => ({
      uid: `${q.chapter || '未知章节'}-${q.id || i}-${q.page_start || 0}-${i}`,
      id: q.id || i + 1,
      chapter: q.chapter || '未知章节',
      section: q.section || '未知小节',
      source: q.source || '来源缺失',
      knowledgePoint: q.knowledge_point || '知识点缺失',
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation || '暂无解析',
    }))
}

function loadProgress() {
  try {
    const text = window.localStorage.getItem(PROGRESS_KEY)
    if (!text) {
      return { answers: {}, favorites: {}, wrong: {} }
    }
    return JSON.parse(text)
  } catch {
    return { answers: {}, favorites: {}, wrong: {} }
  }
}

function loadViewFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return {
    chapter: params.get('chapter') || 'ALL',
    onlyWrong: params.get('wrong') === '1',
    currentUid: params.get('q') || '',
  }
}

function syncViewToUrl({ chapter, onlyWrong, currentUid }) {
  const params = new URLSearchParams()
  if (chapter && chapter !== 'ALL') {
    params.set('chapter', chapter)
  }
  if (onlyWrong) {
    params.set('wrong', '1')
  }
  if (currentUid) {
    params.set('q', currentUid)
  }

  const query = params.toString()
  const nextUrl = query
    ? `${window.location.pathname}?${query}${window.location.hash}`
    : `${window.location.pathname}${window.location.hash}`

  window.history.replaceState(null, '', nextUrl)
}

function App() {
  const [initialView] = useState(loadViewFromUrl)
  const [allQuestions, setAllQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [chapter, setChapter] = useState(initialView.chapter)
  const [currentUid, setCurrentUid] = useState(initialView.currentUid)
  const [showAnswer, setShowAnswer] = useState(false)
  const [onlyWrong, setOnlyWrong] = useState(Boolean(initialView.onlyWrong))
  const [progress, setProgress] = useState(loadProgress)

  useEffect(() => {
    async function init() {
      try {
        const questionsUrl = `${import.meta.env.BASE_URL}questions_all.json`
        const res = await fetch(questionsUrl)
        if (!res.ok) {
          throw new Error(`题库加载失败: ${res.status}`)
        }
        const data = await res.json()
        const normalized = normalizeQuestions(data.questions || [])
        setAllQuestions(normalized)
      } catch (e) {
        setError(e instanceof Error ? e.message : '未知错误')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress))
  }, [progress])

  useEffect(() => {
    syncViewToUrl({ chapter, onlyWrong, currentUid })
  }, [chapter, onlyWrong, currentUid])

  const chapters = useMemo(() => {
    const set = new Set(allQuestions.map((q) => q.chapter))
    return ['ALL', ...Array.from(set)]
  }, [allQuestions])

  useEffect(() => {
    if (allQuestions.length && chapter !== 'ALL' && !chapters.includes(chapter)) {
      setChapter('ALL')
    }
  }, [allQuestions.length, chapter, chapters])

  const filtered = useMemo(() => {
    const chapterFiltered = chapter === 'ALL' ? allQuestions : allQuestions.filter((q) => q.chapter === chapter)
    if (!onlyWrong) {
      return chapterFiltered
    }
    return chapterFiltered.filter((q) => progress.wrong[q.uid])
  }, [allQuestions, chapter, onlyWrong, progress.wrong])

  useEffect(() => {
    if (!filtered.length) {
      if (currentUid) {
        setCurrentUid('')
      }
      setShowAnswer(false)
      return
    }
    if (!filtered.some((q) => q.uid === currentUid)) {
      setCurrentUid(filtered[0].uid)
    }
  }, [filtered, currentUid])

  const index = filtered.findIndex((q) => q.uid === currentUid)
  const current = filtered[index >= 0 ? index : 0]

  useEffect(() => {
    if (!current) {
      setShowAnswer(false)
      return
    }
    setShowAnswer(Boolean(progress.answers[current.uid]))
  }, [current, progress.answers])

  const stats = useMemo(() => {
    const total = allQuestions.length
    const answered = Object.keys(progress.answers).length
    const correct = Object.values(progress.answers).filter((x) => x.correct).length
    const wrong = Object.keys(progress.wrong).length
    return { total, answered, correct, wrong }
  }, [allQuestions, progress.answers, progress.wrong])

  function submit(option) {
    if (!current) {
      return
    }
    const correct = option === current.answer
    setProgress((prev) => {
      const next = {
        ...prev,
        answers: {
          ...prev.answers,
          [current.uid]: {
            selected: option,
            correct,
            at: Date.now(),
          },
        },
        wrong: { ...prev.wrong },
      }
      if (correct) {
        delete next.wrong[current.uid]
      } else {
        next.wrong[current.uid] = {
          chapter: current.chapter,
          stem: current.stem,
        }
      }
      return next
    })
    setShowAnswer(true)
  }

  function toggleFavorite() {
    if (!current) {
      return
    }
    setProgress((prev) => {
      const favorites = { ...prev.favorites }
      if (favorites[current.uid]) {
        delete favorites[current.uid]
      } else {
        favorites[current.uid] = true
      }
      return { ...prev, favorites }
    })
  }

  function nextQuestion() {
    if (!filtered.length) {
      return
    }
    const nextIndex = index + 1 >= filtered.length ? 0 : index + 1
    setCurrentUid(filtered[nextIndex].uid)
  }

  function prevQuestion() {
    if (!filtered.length) {
      return
    }
    const prevIndex = index - 1 < 0 ? filtered.length - 1 : index - 1
    setCurrentUid(filtered[prevIndex].uid)
  }

  if (loading) {
    return <main className="page"><p className="state">正在加载题库...</p></main>
  }

  if (error) {
    return <main className="page"><p className="state state-error">{error}</p></main>
  }

  if (!current) {
    return (
      <main className="page">
        <header className="header">
          <h1>软考刷题</h1>
          <div className="header-stats">
            <span className="pill">总题 {stats.total}</span>
          </div>
        </header>
        <section className="controls">
          <label className="control control-chapter">
            <span className="control-title">章节</span>
            <select value={chapter} onChange={(e) => setChapter(e.target.value)}>
              {chapters.map((c) => (
                <option key={c} value={c}>{c === 'ALL' ? '全部章节' : c}</option>
              ))}
            </select>
          </label>
          <label className="control control-toggle checkbox">
            <input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} />
            只看错题
          </label>
        </section>
        <p className="state">当前筛选下没有题目</p>
      </main>
    )
  }

  const userAnswer = progress.answers[current.uid]
  const favorite = !!progress.favorites[current.uid]

  return (
    <main className="page">
      <header className="header">
        <h1>软考刷题</h1>
        <div className="header-stats">
          <span className="pill">已做 {stats.answered}/{stats.total}</span>
          <span className="pill">正确 {stats.correct}</span>
          <span className="pill">错题 {stats.wrong}</span>
        </div>
      </header>

      <section className="controls">
        <label className="control control-chapter">
          <span className="control-title">章节</span>
          <select value={chapter} onChange={(e) => setChapter(e.target.value)}>
            {chapters.map((c) => (
              <option key={c} value={c}>{c === 'ALL' ? '全部章节' : c}</option>
            ))}
          </select>
        </label>
        <label className="control control-toggle checkbox">
          <input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} />
          只看错题
        </label>
      </section>

      <section className="card">
        <div className="meta">
          <span>{current.chapter}</span>
          <div className="meta-actions">
            <span>{current.section}</span>
            <button
              type="button"
              className={`icon-action${favorite ? ' icon-action-active' : ''}`}
              onClick={toggleFavorite}
              aria-label={favorite ? '取消收藏' : '收藏'}
              title={favorite ? '取消收藏' : '收藏'}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 17.3 5.8 20.6l1.2-7-5.1-5 7.1-1L12 1.2l3 6.4 7.1 1-5.1 5 1.2 7z" />
              </svg>
            </button>
            <button
              type="button"
              className={`icon-action${showAnswer ? ' icon-action-active' : ''}`}
              onClick={() => setShowAnswer((x) => !x)}
              aria-label={showAnswer ? '隐藏解析' : '查看解析'}
              title={showAnswer ? '隐藏解析' : '查看解析'}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5c5.5 0 9.7 4.7 10.8 6-1.1 1.3-5.3 6-10.8 6S2.3 12.3 1.2 11C2.3 9.7 6.5 5 12 5zm0 2.5A3.5 3.5 0 1 0 12 14.5 3.5 3.5 0 0 0 12 7.5z" />
              </svg>
            </button>
          </div>
        </div>
        <h2>{current.id}. {current.stem}</h2>
        <div className="options">
          {Object.entries(current.options).map(([key, text]) => {
            const selected = userAnswer?.selected === key
            const isCorrect = current.answer === key
            let cls = 'option'
            if (showAnswer && isCorrect) {
              cls += ' option-correct'
            } else if (showAnswer && selected && !isCorrect) {
              cls += ' option-wrong'
            } else if (selected) {
              cls += ' option-selected'
            }
            return (
              <button key={key} className={cls} onClick={() => submit(key)} disabled={showAnswer}>
                <strong>{key}.</strong> {text}
              </button>
            )
          })}
        </div>

        {showAnswer && (
          <div className="answer-box">
            <p>正确答案：<b>{current.answer}</b></p>
            <p>{current.explanation}</p>
          </div>
        )}
      </section>

      <section className="actions">
        <div className="actions-primary">
          <button className="action-main" onClick={prevQuestion}>上一题</button>
          <button className="action-main" onClick={nextQuestion}>下一题</button>
        </div>
      </section>

      <footer className="footer">
        <p>题目 {index + 1} / {filtered.length}</p>
        <p>{current.source} · {current.knowledgePoint}</p>
      </footer>
    </main>
  )
}

export default App
