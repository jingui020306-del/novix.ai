import { motion } from 'framer-motion'
import { BookOpen } from 'lucide-react'
export default function Layout({left,center,right}:{left:any,center:any,right:any}){
  return <div className='h-screen grid grid-cols-12'>
    <aside className='panel col-span-2 p-3'><div className='flex gap-2 items-center font-bold mb-3'><BookOpen size={16}/>Workbench</div>{left}</aside>
    <main className='panel col-span-7 p-3'><motion.div initial={{opacity:0}} animate={{opacity:1}}>{center}</motion.div></main>
    <section className='col-span-3 p-3 bg-gray-50'>{right}</section>
  </div>
}
