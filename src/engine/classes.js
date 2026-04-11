// classes.js — class CRUD and default classes

import { KEYS } from '../config.js';
import { load, save } from './storage.js';

const DEFAULT_CLASSES = [
  { id:'cls-acct210',  name:'Accounting 210',               color:'#ff3f6c' },
  { id:'cls-macro',    name:'Macroeconomics',                color:'#b57bee' },
  { id:'cls-csm201',   name:'Consumer Science Management 201', color:'#00e5a0' },
  { id:'cls-mkt300',   name:'Marketing 300',                 color:'#ff8c42' },
  { id:'cls-calc1',    name:'Calculus 1 (Math 125)',          color:'#38b2ff' },
];

export function getClasses() {
  const saved = load(KEYS.classes);
  if (saved && saved.length) return saved;
  save(KEYS.classes, DEFAULT_CLASSES);
  return DEFAULT_CLASSES;
}

export function saveClasses(cls) { save(KEYS.classes, cls); }
