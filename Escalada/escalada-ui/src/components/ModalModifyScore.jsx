import React, { useState, useEffect } from "react";

const ModalModifyScore = ({
  isOpen,
  competitors,
  scores,
  onClose,
  onSubmit
}) => {
  const [selected, setSelected] = useState("");
  const [score, setScore] = useState("");

  useEffect(() => {
    if (isOpen && competitors.length) {
      setSelected(competitors[0]);
    }
  }, [isOpen, competitors]);

  useEffect(() => {
    if (selected) {
      setScore(scores[selected]?.toString() ?? "");
    }
  }, [selected, scores]);

  if (!isOpen) return null;

  return (
    <div className="absolute bg-gray-500 bg-opacity-75 flex items-center justify-center inset-0 z-50">
      <div className="bg-white p-4 rounded shadow-md w-72">
        <h2 className="text-lg font-semibold mb-3">Modify score</h2>
        <div className="mb-4">
          <label className="block mb-1 font-semibold">Select competitor</label>
          <select
            className="w-full border p-2 rounded"
            value={selected}
            onChange={e => setSelected(e.target.value)}
          >
            {competitors.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <form
          onSubmit={e => {
            e.preventDefault();
            const numericScore = parseFloat(score);
            if (isNaN(numericScore)) {
              alert("Invalid score");
              return;
            }
            onSubmit(selected, numericScore);
            setSelected("");
            setScore("");
          }}
        >
          <label className="block mb-1 font-semibold">Score</label>
          <input
            className="w-full border p-2 rounded"
            type="number"
            step="0.1"
            value={score}
            onChange={e => setScore(e.target.value)}
            required
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="px-4 py-1 border rounded" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="px-4 py-1 bg-blue-600 text-white rounded">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalModifyScore;