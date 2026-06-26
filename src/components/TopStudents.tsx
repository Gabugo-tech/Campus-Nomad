import { motion } from 'motion/react';
import { Trophy, MessageCircle, Heart, MessageSquare, Flame } from 'lucide-react';
import { cn } from '../lib/utils';
import { VerificationBadge } from './VerificationBadge';

export interface TopStudentItem {
  userId: string;
  userName: string;
  userAvatar: string;
  campus: string;
  totalLikes: number;
  totalComments: number;
  totalEngagement: number;
  postCount: number;
}

interface TopStudentsProps {
  topStudents: TopStudentItem[];
  activeTab: 'my-campus' | 'global';
  currentUserUid?: string;
  usersMap: Record<string, { email: string; verified: boolean; displayName?: string; avatarUrl?: string; campus?: string; online?: boolean }>;
  onMessageUser: (userId: string) => void;
}

export default function TopStudents({
  topStudents,
  activeTab,
  currentUserUid,
  usersMap,
  onMessageUser
}: TopStudentsProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-[2rem] p-5 shadow-sm overflow-hidden select-none">
      <div className="flex items-center justify-between pb-4 border-b border-slate-150 mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-amber-50 rounded-xl border border-amber-100 text-amber-500">
            <Trophy size={18} className="fill-amber-50" />
          </div>
          <div>
            <h3 className="font-sans font-bold text-xs.5 text-slate-800 tracking-tight leading-none">
              Top Engagers
            </h3>
            <p className="text-[10px] text-slate-400 font-medium font-sans mt-0.5 leading-none">
              {activeTab === 'my-campus' ? 'Campus Social Stars' : 'Global Arena Champions'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-blue-50 border border-blue-100/50 rounded-full py-0.5 px-2 text-[9px] font-black text-blue-600 uppercase tracking-wider">
          <Flame size={10} className="fill-blue-50 shrink-0" />
          <span>Active Stars</span>
        </div>
      </div>

      {topStudents.length === 0 ? (
        <div className="text-center py-6 px-3 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
          <p className="text-[11px] text-slate-500 leading-normal">
            No engagement activity reported yet.
          </p>
          <p className="text-[9px] text-slate-400 mt-0.5 leading-relaxed">
            Create or like posts to launch the social leaderboard!
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {topStudents.map((student, index) => {
            const rank = index + 1;
            const isCurrentUser = student.userId === currentUserUid;
            const isOnline = usersMap[student.userId]?.online;
            const isVerified = usersMap[student.userId]?.verified;

            return (
              <motion.div
                key={student.userId}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05, type: 'spring', stiffness: 350, damping: 25 }}
                whileHover={{ scale: 1.02, x: 3 }}
                className={cn(
                  "p-3 rounded-2xl border flex items-center justify-between transition-all group relative overflow-hidden",
                  isCurrentUser
                    ? "bg-blue-50/55 border-blue-100 ring-1 ring-blue-500/10"
                    : "bg-slate-50/40 border-slate-100/80 hover:bg-white hover:shadow-xs hover:border-slate-200"
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Rank Badge */}
                  <div className="shrink-0 flex items-center justify-center">
                    {rank === 1 ? (
                      <span className="w-6 h-6 rounded-lg bg-amber-100 text-amber-700 font-black text-xs border border-amber-200 flex items-center justify-center shadow-xs">
                        🥇
                      </span>
                    ) : rank === 2 ? (
                      <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-700 font-black text-xs border border-slate-200 flex items-center justify-center shadow-xs">
                        🥈
                      </span>
                    ) : rank === 3 ? (
                      <span className="w-6 h-6 rounded-lg bg-orange-50 text-orange-700 font-black text-xs border border-orange-100/80 flex items-center justify-center shadow-xs">
                        🥉
                      </span>
                    ) : (
                      <span className="w-6 h-6 rounded-lg bg-slate-50 text-slate-500 text-xs font-bold font-mono border border-slate-100 flex items-center justify-center">
                        #{rank}
                      </span>
                    )}
                  </div>

                  {/* Avatar & Online Dot */}
                  <div className="relative shrink-0">
                    <img
                      src={student.userAvatar}
                      className="w-9 h-9 rounded-xl object-cover border border-slate-200 bg-white shadow-2xs"
                      alt={student.userName}
                    />
                    {isOnline && (
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white shadow-xs" />
                    )}
                  </div>

                  {/* Profile Details */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-black text-slate-800 truncate block max-w-[120px] lg:max-w-[130px]">
                        {student.userName}
                      </span>
                      <VerificationBadge 
                        email={usersMap[student.userId]?.email || (isCurrentUser ? usersMap[student.userId]?.email : undefined)}
                        verified={isVerified} 
                      />
                    </div>
                    
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md font-extrabold uppercase scale-90 tracking-wide origin-left shrink-0">
                        {student.campus}
                      </span>
                      {isCurrentUser && (
                        <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md font-bold scale-90 origin-left shrink-0">
                          Me
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Score badge & quick actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div className="flex items-center gap-1.5 justify-end">
                      <span className="text-[12px] font-black tracking-tight text-slate-800">
                        {student.totalEngagement}
                      </span>
                      <Flame size={12} className="text-amber-500 fill-amber-500 animate-pulse shrink-0" />
                    </div>
                    {/* Tooltip detail breakdown on hover or display count */}
                    <div className="flex items-center gap-1.5 text-[8px] text-slate-400 font-semibold font-mono justify-end">
                      <span className="flex items-center">
                        <Heart size={8} className="mr-0.5" /> {student.totalLikes}
                      </span>
                      <span className="flex items-center">
                        <MessageSquare size={8} className="mr-0.5" /> {student.totalComments}
                      </span>
                    </div>
                  </div>

                  {!isCurrentUser && (
                    <button
                      onClick={() => onMessageUser(student.userId)}
                      className="p-1.5 bg-slate-50 hover:bg-blue-600 border border-slate-150 hover:border-blue-500 text-slate-500 hover:text-white rounded-xl transition-all cursor-pointer shadow-xs active:scale-90"
                      title="Direct Chat"
                    >
                      <MessageCircle size={12.5} />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
