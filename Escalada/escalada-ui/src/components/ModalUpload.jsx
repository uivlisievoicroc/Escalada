import React, { useState } from "react";

const ModalUpload = ({ isOpen, onClose, onUpload }) => {
  const [category, setCategory] = useState("");
  const [file, setFile] = useState(null);
  const [routesCount, setRoutesCount] = useState("");
  const [holdsCounts, setHoldsCounts] = useState([]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (
      !file ||
      !category ||
      !routesCount ||
      holdsCounts.length !== Number(routesCount) ||
      holdsCounts.some(h => !h)
    ) return;

    const formData = new FormData();
    formData.append("routesCount", routesCount);
    formData.append("holdsCounts", JSON.stringify(holdsCounts));
    formData.append("category", category);
    formData.append("file", file);
    formData.append("include_clubs", "true");

    const res = await fetch("http://127.0.0.1:8000/api/upload", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Eroare la upload:", errorText);
      return;
    }

    const data = await res.json();

    // asigurăm câmpurile de care avem nevoie în ControlPanel
    const payload = {
      categorie: category,          // în cazul în care back‑end-ul nu-l trimite
      concurenti: data.concurenti || [],  // lista de concurenţi din XLSX
      routesCount,                  // valoarea introdusă în formular
      holdsCounts,                  // array-ul complet
    };

    // dacă back‑end-ul întoarce şi alte informaţii (id, etc.) păstrăm
    Object.assign(payload, data);

    console.log("Upload payload:", payload);
    onUpload(payload);
  };

  if (!isOpen) return null;

  return (
    <div className="mt-4 p-6 bg-white border border-gray-300 rounded shadow-md max-w-md mx-auto">
      <h2 className="text-xl font-semibold mb-4">Upload Listbox</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="Categorie (ex: U16-Baieti)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full border border-gray-300 p-2 rounded"
          required
        />
        {/* Number of routes */}
        <input
          type="number"
          min="1"
          placeholder="Nr of routes"
          value={routesCount}
          onChange={(e) => {
            const val = e.target.value;
            setRoutesCount(val);
            setHoldsCounts(Array(Number(val)).fill(""));
          }}
          className="w-full border border-gray-300 p-2 rounded"
          required
        />
        {/* Holds per route */}
        {routesCount &&
          Array.from({ length: Number(routesCount) }).map((_, i) => (
            <input
              key={i}
              type="number"
              min="1"
              placeholder={`Nr of holds, Route ${i + 1}`}
              value={holdsCounts[i] || ""}
              onChange={(e) => {
                const newCounts = [...holdsCounts];
                newCounts[i] = e.target.value;
                setHoldsCounts(newCounts);
              }}
              className="w-full border border-gray-300 p-2 rounded"
              required
            />
          ))}
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files[0])}
          className="w-full"
          required
        />
        <div className="flex justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 border border-gray-400 rounded"
          >
            Anulează
          </button>
          <button
            type="submit"
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Încarcă
          </button>
        </div>
      </form>
    </div>
  );
};

export default ModalUpload;