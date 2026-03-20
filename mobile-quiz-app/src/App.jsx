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

function App() {
  const [allQuestions, setAllQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [chapter, setChapter] = useState('ALL')
  const [index, setIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [onlyWrong, setOnlyWrong] = useState(false)
  const [progress, setProgress] = useState(loadProgress)

  useEffect(() => {
    async function init() {
      try {
        const res = await fetch('/questions_all.json')
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

  const chapters = useMemo(() => {
    const set = new Set(allQuestions.map((q) => q.chapter))
    return ['ALL', ...Array.from(set)]
  }, [allQuestions])

  const filtered = useMemo(() => {
    const chapterFiltered = chapter === 'ALL' ? allQuestions : allQuestions.filter((q) => q.chapter === chapter)
    if (!onlyWrong) {
      return chapterFiltered
    }
    return chapterFiltered.filter((q) => progress.wrong[q.uid])
  }, [allQuestions, chapter, onlyWrong, progress.wrong])

  useEffect(() => {
    setIndex(0)
    setShowAnswer(false)
  }, [chapter, onlyWrong])

  const current = filtered[index]

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
    setIndex((prev) => (prev + 1 >= filtered.length ? 0 : prev + 1))
    setShowAnswer(false)
  }

  function prevQuestion() {
    if (!filtered.length) {
      return
    }
    setIndex((prev) => (prev - 1 < 0 ? filtered.length - 1 : prev - 1))
    setShowAnswer(false)
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
          <span>{current.section}</span>
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
        <button onClick={prevQuestion}>上一题</button>
        <button onClick={toggleFavorite}>{favorite ? '取消收藏' : '收藏'}</button>
        <button onClick={() => setShowAnswer((x) => !x)}>{showAnswer ? '隐藏解析' : '查看解析'}</button>
        <button onClick={nextQuestion}>下一题</button>
      </section>

      <footer className="footer">
        <p>题目 {index + 1} / {filtered.length}</p>
        <p>{current.source} · {current.knowledgePoint}</p>
      </footer>
    </main>
  )
}

export default App
