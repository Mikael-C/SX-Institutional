const sequelize = require('../config/database');

const UserModel = require('./User');
const OraclePriceModel = require('./OraclePrice');
const DisputeModel = require('./Dispute');
const SwapModel = require('./Swap');
const SettlementModel = require('./Settlement');
const RiskScoreModel = require('./RiskScore');
const FrogScoreModel = require('./FrogScore');
const FundingHistoryModel = require('./FundingHistory');
const HiddenOrderModel = require('./HiddenOrder');
const LeveragedPositionModel = require('./LeveragedPosition');
const RewardModel = require('./Reward');
const LoanModel = require('./Loan');
const ShortPositionModel = require('./ShortPosition');
const KycStatusModel = require('./KycStatus');
const EventModel = require('./Event');
const DeviceModel = require('./Device');
const ProposalModel = require('./Proposal');
const JailbreakLogModel = require('./JailbreakLog');

const db = {};

db.sequelize = sequelize;

db.User = UserModel(sequelize);
db.OraclePrice = OraclePriceModel(sequelize);
db.Dispute = DisputeModel(sequelize);
db.Swap = SwapModel(sequelize);
db.Settlement = SettlementModel(sequelize);
db.RiskScore = RiskScoreModel(sequelize);
db.FrogScore = FrogScoreModel(sequelize);
db.FundingHistory = FundingHistoryModel(sequelize);
db.HiddenOrder = HiddenOrderModel(sequelize);
db.LeveragedPosition = LeveragedPositionModel(sequelize);
db.Reward = RewardModel(sequelize);
db.Loan = LoanModel(sequelize);
db.ShortPosition = ShortPositionModel(sequelize);
db.KycStatus = KycStatusModel(sequelize);
db.Event = EventModel(sequelize);
db.Device = DeviceModel(sequelize);
db.Proposal = ProposalModel(sequelize);
db.JailbreakLog = JailbreakLogModel(sequelize);

// Associations
db.User.hasMany(db.Swap, { foreignKey: 'userId', as: 'swaps' });
db.Swap.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

db.User.hasMany(db.Settlement, { foreignKey: 'userId', as: 'settlements' });
db.Settlement.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

db.User.hasMany(db.RiskScore, { foreignKey: 'userId', as: 'riskScores' });
db.RiskScore.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

db.User.hasMany(db.HiddenOrder, { foreignKey: 'userId', as: 'hiddenOrders' });
db.HiddenOrder.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

db.User.hasMany(db.LeveragedPosition, { foreignKey: 'userId', as: 'leveragedPositions' });
db.LeveragedPosition.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

db.User.hasMany(db.Reward, { foreignKey: 'userId', as: 'rewards' });
db.Reward.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

db.User.hasMany(db.Loan, { foreignKey: 'userId', as: 'loans' });
db.Loan.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

db.User.hasMany(db.ShortPosition, { foreignKey: 'userId', as: 'shortPositions' });
db.ShortPosition.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

db.User.hasMany(db.KycStatus, { foreignKey: 'userId', as: 'kycStatuses' });
db.KycStatus.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

db.Loan.hasMany(db.ShortPosition, { foreignKey: 'loanId', as: 'shortPositions' });
db.ShortPosition.belongsTo(db.Loan, { foreignKey: 'loanId', as: 'loan' });

db.LeveragedPosition.hasMany(db.FundingHistory, { foreignKey: 'positionId', as: 'fundingHistory' });
db.FundingHistory.belongsTo(db.LeveragedPosition, { foreignKey: 'positionId', as: 'position' });

module.exports = db;
